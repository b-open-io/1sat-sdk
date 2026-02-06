import EventEmitter from 'eventemitter3'
import {
	AuthorizationTimeoutError,
	CodeReplayError,
	ErrorCodes,
	FallbackRequiredError,
	OneSatError,
	StateMismatchError,
	TransportUnavailableError,
} from './errors'
import type {
	CWIHandshakeReason,
	CWIRequestMessage,
	CWIResponseMessage,
	CWIState,
	CWIStateMessage,
	CWITransport,
	CWITransportConfig,
	CWITransportEvent,
	CWITransportEventHandler,
	CWITransportName,
	MobileFallbackMode,
} from './types'

const DEFAULT_WALLET_URL = 'https://1sat.market'
const DEFAULT_IFRAME_PATH = '/wallet/cwi'
const DEFAULT_AUTHORIZE_INIT_PATH = '/api/cwi/authorize/init'
const DEFAULT_TOKEN_PATH = '/api/cwi/token'
const DEFAULT_REQUEST_TIMEOUT_MS = 120000
const DEFAULT_DESKTOP_HANDSHAKE_TIMEOUT_MS = 1800
const DEFAULT_MOBILE_HANDSHAKE_TIMEOUT_MS = 900
const DEFAULT_DESKTOP_MAX_RETRIES = 2
const DEFAULT_MOBILE_MAX_RETRIES = 1
const REDIRECT_PENDING_KEY = 'onesat:cwi:redirect:pending'

interface PendingInvocation {
	resolve: (value: unknown) => void
	reject: (error: Error) => void
	timeoutId: ReturnType<typeof setTimeout>
}

interface StateWaiter {
	resolve: (state: CWIState) => void
	reject: (error: Error) => void
	timeoutId: ReturnType<typeof setTimeout>
}

interface RedirectPendingSession {
	state: string
	codeVerifier: string
	redirectUri: string
	createdAt: number
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null

const isLikelyMobileRuntime = (): boolean => {
	if (typeof navigator === 'undefined') return false

	if (
		'userAgentData' in navigator &&
		typeof navigator.userAgentData === 'object' &&
		navigator.userAgentData !== null &&
		'mobile' in navigator.userAgentData
	) {
		const maybeMobile = (navigator.userAgentData as { mobile?: unknown }).mobile
		if (typeof maybeMobile === 'boolean') {
			return maybeMobile
		}
	}

	const userAgent = navigator.userAgent ?? ''
	return /Android|iPhone|iPad|iPod|Mobile/i.test(userAgent)
}

const createId = (): string => {
	if (
		typeof crypto !== 'undefined' &&
		typeof crypto.randomUUID === 'function'
	) {
		return crypto.randomUUID()
	}
	return `${Date.now()}-${Math.random().toString(36).slice(2, 14)}`
}

const base64UrlEncodeBytes = (input: Uint8Array): string => {
	let binary = ''
	for (const byte of input) {
		binary += String.fromCharCode(byte)
	}
	return btoa(binary)
		.replace(/\+/g, '-')
		.replace(/\//g, '_')
		.replace(/=+$/g, '')
}

const randomBase64Url = (length = 64): string => {
	const charset =
		'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
	if (
		typeof crypto !== 'undefined' &&
		typeof crypto.getRandomValues === 'function'
	) {
		const bytes = new Uint8Array(length)
		crypto.getRandomValues(bytes)
		return Array.from(bytes, (byte) => charset[byte % charset.length]).join('')
	}
	return Array.from({ length }, () => {
		const index = Math.floor(Math.random() * charset.length)
		return charset[index]
	}).join('')
}

const computeS256 = async (verifier: string): Promise<string> => {
	if (
		typeof crypto === 'undefined' ||
		typeof crypto.subtle === 'undefined' ||
		typeof TextEncoder === 'undefined'
	) {
		return verifier
	}
	const digest = await crypto.subtle.digest(
		'SHA-256',
		new TextEncoder().encode(verifier),
	)
	return base64UrlEncodeBytes(new Uint8Array(digest))
}

const toSearchParams = (
	searchParams?: URLSearchParams | string,
): URLSearchParams => {
	if (searchParams instanceof URLSearchParams) {
		return searchParams
	}
	if (typeof searchParams === 'string') {
		const trimmed = searchParams.startsWith('?')
			? searchParams.slice(1)
			: searchParams
		return new URLSearchParams(trimmed)
	}
	if (typeof window !== 'undefined') {
		return new URLSearchParams(window.location.search)
	}
	return new URLSearchParams()
}

const normalizeReason = (value: unknown): CWIHandshakeReason | undefined => {
	if (
		value === 'channel_unavailable' ||
		value === 'wallet_tab_unreachable' ||
		value === 'wallet_locked'
	) {
		return value
	}
	return undefined
}

const normalizeState = (state: CWIState): CWIState => ({
	status:
		state.status === 'checking' ||
		state.status === 'locked' ||
		state.status === 'unlocked' ||
		state.status === 'no-wallet'
			? state.status
			: undefined,
	hasPermission:
		typeof state.hasPermission === 'boolean' ? state.hasPermission : undefined,
	transport: state.transport === 'embed' ? 'embed' : undefined,
	fallbackRecommended:
		typeof state.fallbackRecommended === 'boolean'
			? state.fallbackRecommended
			: undefined,
	reason: normalizeReason(state.reason),
})

const isCWIStateMessage = (value: unknown): value is CWIStateMessage => {
	if (!isRecord(value)) return false
	if (value.type !== 'CWI') return false
	if (!isRecord(value.cwiState)) return false
	return true
}

const isCWIResponseMessage = (value: unknown): value is CWIResponseMessage => {
	if (!isRecord(value)) return false
	if (value.type !== 'CWI') return false
	if (value.isInvocation !== false) return false
	if (typeof value.id !== 'string') return false
	return true
}

const toCWIError = (message: CWIResponseMessage): OneSatError =>
	new OneSatError(
		ErrorCodes.INTERNAL_ERROR,
		message.description ?? 'Wallet request failed',
		{ code: message.code },
	)

const extractErrorDescription = (value: unknown): string | undefined => {
	if (!isRecord(value)) return undefined
	const description = value.error_description
	if (typeof description === 'string' && description.length > 0) {
		return description
	}
	const fallback = value.error
	if (typeof fallback === 'string' && fallback.length > 0) {
		return fallback
	}
	return undefined
}

const emitTransportEvent = (
	emitter: EventEmitter,
	event: CWITransportEvent,
): void => {
	emitter.emit('transport', event)
}

const withFetchTimeout = async (
	input: string,
	init: RequestInit,
	timeoutMs: number,
	onTimeout: () => Error,
): Promise<Response> => {
	const controller = new AbortController()
	const timeoutId = setTimeout(() => {
		controller.abort()
	}, timeoutMs)

	try {
		return await fetch(input, {
			...init,
			signal: controller.signal,
		})
	} catch (error) {
		if (error instanceof Error && error.name === 'AbortError') {
			throw onTimeout()
		}
		throw error
	} finally {
		clearTimeout(timeoutId)
	}
}

export class EmbedTransport implements CWITransport {
	readonly mode = 'embed' as const

	private walletOrigin: string
	private iframeUrl: string
	private requestTimeoutMs: number
	private handshakeTimeoutMs: number
	private iframe: HTMLIFrameElement | null = null
	private pendingInvocations = new Map<string, PendingInvocation>()
	private stateWaiters = new Set<StateWaiter>()
	private lastState: CWIState | null = null
	private events = new EventEmitter()
	private isDestroyed = false

	constructor(config?: CWITransportConfig) {
		const walletUrl = config?.walletUrl ?? DEFAULT_WALLET_URL
		const iframePath = config?.iframePath ?? DEFAULT_IFRAME_PATH

		this.walletOrigin = new URL(walletUrl).origin
		this.iframeUrl = new URL(iframePath, walletUrl).toString()
		this.requestTimeoutMs = config?.timeout ?? DEFAULT_REQUEST_TIMEOUT_MS
		this.handshakeTimeoutMs =
			config?.handshakeTimeoutMs ??
			(isLikelyMobileRuntime()
				? DEFAULT_MOBILE_HANDSHAKE_TIMEOUT_MS
				: DEFAULT_DESKTOP_HANDSHAKE_TIMEOUT_MS)

		if (typeof window !== 'undefined') {
			window.addEventListener('message', this.handleMessage)
		}
	}

	private handleMessage = (event: MessageEvent): void => {
		if (this.isDestroyed) return
		if (event.origin !== this.walletOrigin) return
		if (!this.iframe || event.source !== this.iframe.contentWindow) return

		if (isCWIStateMessage(event.data)) {
			const state = normalizeState(event.data.cwiState)
			this.lastState = state
			this.resolveStateWaiters(state)
			this.updateIframeVisibility(state.hasPermission === true)

			if (state.fallbackRecommended) {
				emitTransportEvent(this.events, {
					type: 'fallback',
					transport: 'embed',
					reason: state.reason ?? 'channel_unavailable',
				})
			}
			return
		}

		if (!isCWIResponseMessage(event.data)) return
		const pending = this.pendingInvocations.get(event.data.id)
		if (!pending) return

		this.pendingInvocations.delete(event.data.id)
		clearTimeout(pending.timeoutId)

		if (event.data.status === 'error') {
			pending.reject(toCWIError(event.data))
			return
		}

		pending.resolve(event.data.result)
	}

	private ensureIframe(): HTMLIFrameElement {
		if (typeof window === 'undefined' || typeof document === 'undefined') {
			throw new TransportUnavailableError('Embed transport requires a browser')
		}
		if (this.iframe?.contentWindow) {
			return this.iframe
		}

		const iframe = document.createElement('iframe')
		iframe.src = this.iframeUrl
		iframe.setAttribute('aria-hidden', 'true')
		iframe.style.position = 'fixed'
		iframe.style.top = '0'
		iframe.style.left = '0'
		iframe.style.width = '0'
		iframe.style.height = '0'
		iframe.style.border = '0'
		iframe.style.opacity = '0'
		iframe.style.pointerEvents = 'none'

		const parent = document.body ?? document.documentElement
		if (!parent) {
			throw new TransportUnavailableError(
				'Unable to mount CWI iframe in document',
			)
		}
		parent.appendChild(iframe)
		this.iframe = iframe
		this.updateIframeVisibility(false)
		return iframe
	}

	private updateIframeVisibility(showPermission: boolean): void {
		const iframe = this.iframe
		if (!iframe) return

		iframe.style.zIndex = '2147483647'
		if (showPermission) {
			iframe.style.width = '100%'
			iframe.style.height = '100%'
			iframe.style.opacity = '1'
			iframe.style.pointerEvents = 'auto'
			return
		}

		iframe.style.width = '0'
		iframe.style.height = '0'
		iframe.style.opacity = '0'
		iframe.style.pointerEvents = 'none'
	}

	private resolveStateWaiters(state: CWIState): void {
		for (const waiter of this.stateWaiters) {
			clearTimeout(waiter.timeoutId)
			waiter.resolve(state)
		}
		this.stateWaiters.clear()
	}

	private async waitForState(timeoutMs: number): Promise<CWIState> {
		if (this.lastState) {
			return this.lastState
		}

		return new Promise<CWIState>((resolve, reject) => {
			const waiter: StateWaiter = {
				resolve,
				reject,
				timeoutId: setTimeout(() => {
					this.stateWaiters.delete(waiter)
					reject(new AuthorizationTimeoutError('Embed handshake timed out'))
				}, timeoutMs),
			}
			this.stateWaiters.add(waiter)
		})
	}

	async handshake(timeoutMs = this.handshakeTimeoutMs): Promise<CWIState> {
		this.ensureIframe()
		const state = await this.waitForState(timeoutMs)
		if (state.fallbackRecommended) {
			throw new FallbackRequiredError(
				`Embed fallback recommended${state.reason ? ` (${state.reason})` : ''}`,
				{ reason: state.reason },
			)
		}
		return state
	}

	async invoke<TResult = unknown>(
		call: string,
		args?: unknown,
	): Promise<TResult> {
		if (typeof call !== 'string' || call.length === 0) {
			throw new OneSatError(ErrorCodes.INVALID_REQUEST, 'Invalid CWI call')
		}

		await this.handshake()
		const iframe = this.ensureIframe()
		const target = iframe.contentWindow
		if (!target) {
			throw new TransportUnavailableError('CWI iframe is not reachable')
		}

		const requestId = createId()
		const request: CWIRequestMessage = {
			type: 'CWI',
			isInvocation: true,
			id: requestId,
			call,
			args,
		}

		return new Promise<TResult>((resolve, reject) => {
			const timeoutId = setTimeout(() => {
				this.pendingInvocations.delete(requestId)
				reject(new AuthorizationTimeoutError(`CWI request timed out: ${call}`))
			}, this.requestTimeoutMs)

			this.pendingInvocations.set(requestId, {
				resolve: resolve as (value: unknown) => void,
				reject,
				timeoutId,
			})

			try {
				target.postMessage(request, this.walletOrigin)
				emitTransportEvent(this.events, {
					type: 'selected',
					transport: 'embed',
				})
			} catch (error) {
				clearTimeout(timeoutId)
				this.pendingInvocations.delete(requestId)
				reject(
					new TransportUnavailableError(
						'Failed to post message to CWI iframe',
						{
							cause: error instanceof Error ? error.message : String(error),
						},
					),
				)
			}
		})
	}

	async resume<TResult = unknown>(): Promise<TResult | null> {
		return null
	}

	on(event: 'transport', handler: CWITransportEventHandler): void {
		this.events.on(event, handler)
	}

	off(event: 'transport', handler: CWITransportEventHandler): void {
		this.events.off(event, handler)
	}

	destroy(): void {
		if (this.isDestroyed) return
		this.isDestroyed = true

		if (typeof window !== 'undefined') {
			window.removeEventListener('message', this.handleMessage)
		}

		for (const pending of this.pendingInvocations.values()) {
			clearTimeout(pending.timeoutId)
			pending.reject(new TransportUnavailableError('Embed transport destroyed'))
		}
		this.pendingInvocations.clear()

		for (const waiter of this.stateWaiters) {
			clearTimeout(waiter.timeoutId)
			waiter.reject(new TransportUnavailableError('Embed transport destroyed'))
		}
		this.stateWaiters.clear()

		const iframe = this.iframe
		if (iframe?.parentNode) {
			iframe.parentNode.removeChild(iframe)
		}
		this.iframe = null
	}
}

export class RedirectTransport implements CWITransport {
	readonly mode = 'redirect' as const

	private authorizeInitUrl: string
	private tokenUrl: string
	private redirectUri: string | null
	private timeoutMs: number
	private events = new EventEmitter()

	constructor(config?: CWITransportConfig) {
		const walletUrl = config?.walletUrl ?? DEFAULT_WALLET_URL
		const authorizeInitPath =
			config?.authorizeInitPath ?? DEFAULT_AUTHORIZE_INIT_PATH
		const tokenPath = config?.tokenPath ?? DEFAULT_TOKEN_PATH

		this.authorizeInitUrl = new URL(authorizeInitPath, walletUrl).toString()
		this.tokenUrl = new URL(tokenPath, walletUrl).toString()
		this.timeoutMs = config?.timeout ?? DEFAULT_REQUEST_TIMEOUT_MS

		if (config?.redirectUri) {
			this.redirectUri = config.redirectUri
		} else if (typeof window !== 'undefined') {
			this.redirectUri = `${window.location.origin}${window.location.pathname}`
		} else {
			this.redirectUri = null
		}
	}

	private savePendingSession(session: RedirectPendingSession): void {
		if (typeof sessionStorage === 'undefined') return
		sessionStorage.setItem(REDIRECT_PENDING_KEY, JSON.stringify(session))
	}

	private loadPendingSession(): RedirectPendingSession | null {
		if (typeof sessionStorage === 'undefined') return null
		const raw = sessionStorage.getItem(REDIRECT_PENDING_KEY)
		if (!raw) return null

		try {
			const parsed = JSON.parse(raw) as RedirectPendingSession
			if (
				typeof parsed.state !== 'string' ||
				typeof parsed.codeVerifier !== 'string' ||
				typeof parsed.redirectUri !== 'string' ||
				typeof parsed.createdAt !== 'number'
			) {
				return null
			}
			return parsed
		} catch {
			return null
		}
	}

	private clearPendingSession(): void {
		if (typeof sessionStorage === 'undefined') return
		sessionStorage.removeItem(REDIRECT_PENDING_KEY)
	}

	private clearAuthQueryParams(): void {
		if (typeof window === 'undefined' || typeof history === 'undefined') return

		const url = new URL(window.location.href)
		let changed = false
		for (const key of ['code', 'state', 'error', 'error_description']) {
			if (url.searchParams.has(key)) {
				url.searchParams.delete(key)
				changed = true
			}
		}
		if (changed) {
			history.replaceState(history.state, '', url.toString())
		}
	}

	private async initializeAuthorization(
		call: string,
		args: unknown,
	): Promise<{
		authorizeUrl: string
		session: RedirectPendingSession
	}> {
		if (typeof window === 'undefined') {
			throw new TransportUnavailableError(
				'Redirect transport requires a browser',
			)
		}
		if (!this.redirectUri) {
			throw new TransportUnavailableError(
				'redirectUri is required for redirect fallback',
			)
		}

		const state = randomBase64Url(48)
		const nonce = randomBase64Url(48)
		const verifier = randomBase64Url(64)

		const hasSubtle =
			typeof crypto !== 'undefined' &&
			typeof crypto.subtle !== 'undefined' &&
			typeof TextEncoder !== 'undefined'
		const method = hasSubtle ? 'S256' : 'plain'
		const codeChallenge = await computeS256(verifier)

		const body = {
			call,
			args: args ?? {},
			redirect_uri: this.redirectUri,
			state,
			nonce,
			code_challenge: codeChallenge,
			code_challenge_method: method,
		}

		const response = await withFetchTimeout(
			this.authorizeInitUrl,
			{
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(body),
				credentials: 'omit',
			},
			this.timeoutMs,
			() => new AuthorizationTimeoutError('authorize/init timed out'),
		)

		const payload = (await response.json().catch(() => ({}))) as unknown
		if (!response.ok || !isRecord(payload)) {
			const description =
				extractErrorDescription(payload) ??
				'Failed to initialize redirect authorization'
			throw new OneSatError(ErrorCodes.INVALID_REQUEST, description, payload)
		}

		const authorizeUrl = payload.authorizeUrl
		if (typeof authorizeUrl !== 'string' || authorizeUrl.length === 0) {
			throw new TransportUnavailableError(
				'authorize/init did not return authorizeUrl',
			)
		}

		return {
			authorizeUrl,
			session: {
				state,
				codeVerifier: verifier,
				redirectUri: this.redirectUri,
				createdAt: Date.now(),
			},
		}
	}

	async invoke<TResult = unknown>(
		call: string,
		args?: unknown,
	): Promise<TResult> {
		if (typeof call !== 'string' || call.length === 0) {
			throw new OneSatError(ErrorCodes.INVALID_REQUEST, 'Invalid CWI call')
		}
		if (typeof window === 'undefined') {
			throw new TransportUnavailableError(
				'Redirect transport requires a browser',
			)
		}

		const { authorizeUrl, session } = await this.initializeAuthorization(
			call,
			args,
		)
		this.savePendingSession(session)

		emitTransportEvent(this.events, {
			type: 'selected',
			transport: 'redirect',
		})

		window.location.assign(authorizeUrl)
		return new Promise<TResult>(() => {
			// Intentionally unresolved: top-level navigation takes over.
		})
	}

	private async exchangeCode<TResult = unknown>(
		code: string,
		session: RedirectPendingSession,
	): Promise<TResult> {
		const response = await withFetchTimeout(
			this.tokenUrl,
			{
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					code,
					code_verifier: session.codeVerifier,
					redirect_uri: session.redirectUri,
				}),
				credentials: 'omit',
			},
			this.timeoutMs,
			() => new AuthorizationTimeoutError('token exchange timed out'),
		)

		const payload = (await response.json().catch(() => ({}))) as unknown
		if (!response.ok || !isRecord(payload)) {
			const description =
				extractErrorDescription(payload) ?? 'Authorization code exchange failed'
			if (/already_consumed|replay|consumed/i.test(description)) {
				throw new CodeReplayError(description)
			}
			throw new OneSatError(ErrorCodes.INTERNAL_ERROR, description, payload)
		}

		if ('error' in payload) {
			const description =
				extractErrorDescription(payload) ?? 'Authorization request failed'
			if (/already_consumed|replay|consumed/i.test(description)) {
				throw new CodeReplayError(description)
			}
			throw new OneSatError(ErrorCodes.INTERNAL_ERROR, description, payload)
		}

		return payload.result as TResult
	}

	async resume<TResult = unknown>(
		searchParams?: URLSearchParams | string,
	): Promise<TResult | null> {
		const params = toSearchParams(searchParams)
		const code = params.get('code')
		const state = params.get('state')
		const error = params.get('error')
		const errorDescription = params.get('error_description')

		if (!code && !error) {
			return null
		}

		const session = this.loadPendingSession()
		if (!session || !state || state !== session.state) {
			this.clearPendingSession()
			this.clearAuthQueryParams()
			throw new StateMismatchError('Redirect callback state mismatch')
		}

		if (error) {
			this.clearPendingSession()
			this.clearAuthQueryParams()
			const payload = {
				error,
				error_description: errorDescription ?? undefined,
			}

			if (error === 'access_denied') {
				throw new OneSatError(
					ErrorCodes.USER_REJECTED,
					errorDescription ?? 'User denied authorization',
					payload,
				)
			}

			throw new OneSatError(
				ErrorCodes.INTERNAL_ERROR,
				errorDescription ?? `Authorization callback error: ${error}`,
				payload,
			)
		}

		if (!code) {
			this.clearPendingSession()
			this.clearAuthQueryParams()
			throw new TransportUnavailableError(
				'Redirect callback missing authorization code',
			)
		}

		const result = await this.exchangeCode<TResult>(code, session)
		this.clearPendingSession()
		this.clearAuthQueryParams()
		return result
	}

	on(event: 'transport', handler: CWITransportEventHandler): void {
		this.events.on(event, handler)
	}

	off(event: 'transport', handler: CWITransportEventHandler): void {
		this.events.off(event, handler)
	}

	destroy(): void {
		this.clearPendingSession()
	}
}

export class AutoTransport implements CWITransport {
	readonly mode = 'auto' as const

	private embed: EmbedTransport
	private redirect: RedirectTransport
	private events = new EventEmitter()
	private selectedTransport: CWITransportName | null = null
	private mobileFallback: MobileFallbackMode
	private maxEmbedRetries: number

	constructor(config?: CWITransportConfig) {
		const isMobile = isLikelyMobileRuntime()
		this.mobileFallback =
			config?.mobileFallback ?? (isMobile ? 'auto' : 'embed-only')
		const handshakeTimeoutMs =
			config?.handshakeTimeoutMs ??
			(isMobile
				? DEFAULT_MOBILE_HANDSHAKE_TIMEOUT_MS
				: DEFAULT_DESKTOP_HANDSHAKE_TIMEOUT_MS)
		this.maxEmbedRetries = Math.max(
			1,
			config?.maxEmbedRetries ??
				(isMobile ? DEFAULT_MOBILE_MAX_RETRIES : DEFAULT_DESKTOP_MAX_RETRIES),
		)

		this.embed = new EmbedTransport({
			...config,
			handshakeTimeoutMs,
		})
		this.redirect = new RedirectTransport(config)
	}

	private selectTransport(
		transport: CWITransportName,
		reason?: string,
		kind: CWITransportEvent['type'] = 'selected',
	): void {
		if (this.selectedTransport === transport && kind === 'selected') return

		const previous = this.selectedTransport
		this.selectedTransport = transport
		emitTransportEvent(this.events, {
			type: kind,
			transport,
			previousTransport: previous ?? undefined,
			reason,
		})
	}

	private shouldTryRedirect(): boolean {
		return this.mobileFallback !== 'embed-only'
	}

	private shouldUseRedirectDirectly(): boolean {
		return this.mobileFallback === 'redirect'
	}

	private shouldRetryEmbed(error: Error): boolean {
		return (
			error instanceof AuthorizationTimeoutError ||
			error instanceof TransportUnavailableError
		)
	}

	private shouldFallbackToRedirect(error: Error): boolean {
		return (
			error instanceof FallbackRequiredError ||
			error instanceof AuthorizationTimeoutError ||
			error instanceof TransportUnavailableError
		)
	}

	private toFallbackReason(error: Error): CWIHandshakeReason {
		if (error instanceof FallbackRequiredError) {
			const data = error.data
			if (isRecord(data)) {
				const reason = normalizeReason(data.reason)
				if (reason) {
					return reason
				}
			}
			return 'channel_unavailable'
		}
		if (error instanceof AuthorizationTimeoutError) {
			return 'wallet_tab_unreachable'
		}
		return 'channel_unavailable'
	}

	async invoke<TResult = unknown>(
		call: string,
		args?: unknown,
	): Promise<TResult> {
		if (
			this.selectedTransport === 'redirect' ||
			this.shouldUseRedirectDirectly()
		) {
			this.selectTransport(
				'redirect',
				this.shouldUseRedirectDirectly()
					? 'mobile_fallback_redirect'
					: undefined,
			)
			return this.redirect.invoke<TResult>(call, args)
		}

		try {
			const result = await this.embed.invoke<TResult>(call, args)
			this.selectTransport('embed')
			return result
		} catch (error) {
			let resolvedError =
				error instanceof Error
					? error
					: new TransportUnavailableError(String(error))

			if (
				this.selectedTransport !== 'embed' &&
				this.shouldRetryEmbed(resolvedError) &&
				this.maxEmbedRetries > 1
			) {
				for (let attempt = 2; attempt <= this.maxEmbedRetries; attempt += 1) {
					try {
						const result = await this.embed.invoke<TResult>(call, args)
						this.selectTransport('embed', `embed_retry_${attempt}`)
						return result
					} catch (retryError) {
						if (!(retryError instanceof Error)) {
							throw retryError
						}
						resolvedError = retryError
						if (!this.shouldRetryEmbed(retryError)) {
							break
						}
					}
				}
			}

			if (!this.shouldFallbackToRedirect(resolvedError)) {
				throw resolvedError
			}
			if (!this.shouldTryRedirect()) {
				throw resolvedError
			}

			const reason = this.toFallbackReason(resolvedError)
			this.selectTransport('redirect', reason, 'fallback')
			return this.redirect.invoke<TResult>(call, args)
		}
	}

	async resume<TResult = unknown>(
		searchParams?: URLSearchParams | string,
	): Promise<TResult | null> {
		const result = await this.redirect.resume<TResult>(searchParams)
		if (result !== null) {
			this.selectTransport('redirect', 'redirect_callback')
		}
		return result
	}

	on(event: 'transport', handler: CWITransportEventHandler): void {
		this.events.on(event, handler)
	}

	off(event: 'transport', handler: CWITransportEventHandler): void {
		this.events.off(event, handler)
	}

	destroy(): void {
		this.embed.destroy()
		this.redirect.destroy()
	}
}

export const createEmbedTransport = (
	config?: CWITransportConfig,
): EmbedTransport => new EmbedTransport(config)

export const createRedirectTransport = (
	config?: CWITransportConfig,
): RedirectTransport => new RedirectTransport(config)

export const createAutoTransport = (
	config?: CWITransportConfig,
): AutoTransport => new AutoTransport(config)
