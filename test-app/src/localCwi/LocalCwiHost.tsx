/**
 * Boots a local browser wallet + 1Sat permission module + WPM.
 * Toggles:
 * - localEnabled → expose / hide window.CWI (vs extension-only)
 * - adminOriginator → actions use admin (no prompt, still apply) vs dApp (prompt)
 */

import type { PromptRequest } from '@1sat/permission-module'
import { createOneSatPermissionModule } from '@1sat/permission-module'
import { OneSatPermissionPrompt } from '@1sat/permission-module-ui'
import { LocalWalletPermissionsManager } from '@1sat/wallet'
import { createWebWallet, IndexedDbPermissionStore } from '@1sat/wallet-browser'
import { PrivateKey, type WalletInterface } from '@bsv/sdk'
import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
} from 'react'
import {
	CorePermissionPrompt,
	type CorePermissionRequest,
	type CounterpartyRequest,
	type GroupedRequest,
	type PendingCore,
} from './CorePermissionPrompt'
import {
	ADMIN_ORIGINATOR,
	REMOTE_BACKUP_URL,
	STORAGE_IDENTITY_KEY,
	TOGGLE_ADMIN_KEY,
	TOGGLE_LOCAL_KEY,
	WIF_STORAGE_KEY,
} from './constants'

type PromptState = {
	request: PromptRequest
	resolve: (ok: boolean) => void
}

/** One queued core WPM request plus the handler promise it is blocking. */
type CoreEntry = {
	pending: PendingCore
	resolve: () => void
	reject: (err: Error) => void
}

type LocalCwiStatus = 'idle' | 'booting' | 'ready' | 'error'

export type LocalCwiContextValue = {
	status: LocalCwiStatus
	error: string | null
	identityKey: string | null
	/** Gated WPM instance (null until ready). */
	gatedWallet: WalletInterface | null
	/** Expose as window.CWI for Connect / WalletClient('auto'). */
	localEnabled: boolean
	setLocalEnabled: (on: boolean) => void
	/** Actions bind admin originator (silent apply) vs dApp (prompt). */
	adminOriginator: boolean
	setAdminOriginator: (on: boolean) => void
}

const LocalCwiContext = createContext<LocalCwiContextValue | null>(null)

export function useLocalCwi(): LocalCwiContextValue {
	const ctx = useContext(LocalCwiContext)
	if (!ctx) {
		throw new Error('useLocalCwi must be used within LocalCwiHost')
	}
	return ctx
}

function readToggle(
	key: string,
	fallback: boolean,
	store: Storage = localStorage,
): boolean {
	try {
		const v = store.getItem(key)
		if (v === null) return fallback
		return v === '1' || v === 'true'
	} catch {
		return fallback
	}
}

function writeToggle(
	key: string,
	on: boolean,
	store: Storage = localStorage,
): void {
	try {
		store.setItem(key, on ? '1' : '0')
	} catch {
		/* ignore */
	}
}

function loadOrCreateWif(): string {
	try {
		const existing = localStorage.getItem(WIF_STORAGE_KEY)
		if (existing) return existing
	} catch {
		/* ignore */
	}
	const wif = PrivateKey.fromRandom().toWif()
	try {
		localStorage.setItem(WIF_STORAGE_KEY, wif)
	} catch {
		/* ignore */
	}
	return wif
}

export function LocalCwiHost({ children }: { children: ReactNode }) {
	const [status, setStatus] = useState<LocalCwiStatus>('booting')
	const [error, setError] = useState<string | null>(null)
	const [identityKey, setIdentityKey] = useState<string | null>(null)
	const [gatedWallet, setGatedWallet] = useState<WalletInterface | null>(null)
	// sessionStorage, not localStorage: survives reloads within the tab but
	// starts off in a fresh browser, so window.CWI does not front-run Yours or
	// other BRC-100 wallets.
	const [localEnabled, setLocalEnabledState] = useState(() =>
		readToggle(TOGGLE_LOCAL_KEY, false, sessionStorage),
	)
	const [adminOriginator, setAdminOriginatorState] = useState(() =>
		readToggle(TOGGLE_ADMIN_KEY, false),
	)
	const [prompt, setPrompt] = useState<PromptState | null>(null)
	const [coreQueue, setCoreQueue] = useState<CoreEntry[]>([])
	const destroyRef = useRef<(() => Promise<void>) | null>(null)
	const gatedRef = useRef<LocalWalletPermissionsManager | null>(null)

	const promptHandler = useCallback((request: PromptRequest) => {
		return new Promise<boolean>((resolve) => {
			setPrompt({ request, resolve })
		})
	}, [])

	/** Block the WPM callback until the user answers the queued card. */
	const enqueueCore = useCallback((pending: PendingCore) => {
		return new Promise<void>((resolve, reject) => {
			setCoreQueue((q) => [...q, { pending, resolve, reject }])
		})
	}, [])

	const setLocalEnabled = useCallback((on: boolean) => {
		writeToggle(TOGGLE_LOCAL_KEY, on, sessionStorage)
		setLocalEnabledState(on)
	}, [])

	const setAdminOriginator = useCallback((on: boolean) => {
		writeToggle(TOGGLE_ADMIN_KEY, on)
		setAdminOriginatorState(on)
	}, [])

	// Boot wallet once
	useEffect(() => {
		let cancelled = false

		;(async () => {
			try {
				setStatus('booting')
				const wif = loadOrCreateWif()
				const privateKey = PrivateKey.fromWif(wif)

				const web = await createWebWallet({
					privateKey,
					chain: 'main',
					storageIdentityKey: STORAGE_IDENTITY_KEY,
					// Local stays active; remote is a backup so test assets survive
					// losing the browser profile. Without it the only record of each
					// asset's derivation is this profile's IndexedDB — the key alone
					// cannot rediscover outputs locked at per-asset keyIDs.
					// Non-fatal when unreachable.
					backups: [REMOTE_BACKUP_URL],
				})
				if (cancelled) {
					await web.destroy()
					return
				}
				destroyRef.current = web.destroy
				// Exposed for harness inspection — confirm the remote backup attached
				// and that BackupSync has somewhere to write.
				;(window as unknown as Record<string, unknown>).__walletStorage =
					web.storage
				;(window as unknown as Record<string, unknown>).__walletMonitor =
					web.monitor

				const permissionStore = new IndexedDbPermissionStore({
					scope: '1sat-test-app',
				})

				const baseWallet = web.wallet
				const oneSatModule = createOneSatPermissionModule({
					wallet: baseWallet,
					// Enables live verification of purchase cards. Optional —
					// without it every purchase stays `unverified`.
					services: web.services,
					promptHandler,
					adminOriginator: ADMIN_ORIGINATOR,
					permissionStore,
				})

				const gated = new LocalWalletPermissionsManager(
					baseWallet,
					ADMIN_ORIGINATOR,
					{ permissionModules: { '1sat': oneSatModule } },
					{ store: permissionStore },
				)

				// Core WPM prompts (protocol / basket / certificate / spending /
				// grouped / counterparty). Without these bound the manager emits
				// to nobody and every sought permission hangs forever.
				for (const event of [
					'onProtocolPermissionRequested',
					'onBasketAccessRequested',
					'onCertificateAccessRequested',
					'onSpendingAuthorizationRequested',
				] as const) {
					gated.bindCallback(event, (request: unknown) =>
						enqueueCore({
							kind: 'single',
							request: request as CorePermissionRequest,
						}),
					)
				}
				gated.bindCallback('onGroupedPermissionRequested', (request: unknown) =>
					enqueueCore({ kind: 'grouped', request: request as GroupedRequest }),
				)
				gated.bindCallback(
					'onCounterpartyPermissionRequested',
					(request: unknown) =>
						enqueueCore({
							kind: 'counterparty',
							request: request as CounterpartyRequest,
						}),
				)

				gatedRef.current = gated
				setGatedWallet(gated)

				const { publicKey } = await gated.getPublicKey(
					{ identityKey: true },
					ADMIN_ORIGINATOR,
				)
				if (!cancelled) {
					setIdentityKey(publicKey)
					setStatus('ready')
					console.info(
						'[LocalCwiHost] gated wallet ready. identity:',
						publicKey.slice(0, 12) + '…',
					)
				}
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err)
				console.error('[LocalCwiHost]', err)
				if (!cancelled) {
					setError(msg)
					setStatus('error')
				}
			}
		})()

		return () => {
			cancelled = true
			if (window.CWI && window.CWI === gatedRef.current) {
				delete window.CWI
			}
			gatedRef.current = null
			const destroy = destroyRef.current
			destroyRef.current = null
			void destroy?.()
		}
	}, [promptHandler])

	// Sync window.CWI with localEnabled toggle
	useEffect(() => {
		if (status !== 'ready' || !gatedWallet) return
		if (localEnabled) {
			window.CWI = gatedWallet
			console.info('[LocalCwiHost] window.CWI ON (local gated)')
		} else {
			if (window.CWI === gatedWallet) {
				delete window.CWI
			}
			console.info('[LocalCwiHost] window.CWI OFF — use extension')
		}
	}, [localEnabled, gatedWallet, status])

	const onApprove = useCallback(() => {
		if (!prompt) return
		prompt.resolve(true)
		setPrompt(null)
	}, [prompt])

	const onReject = useCallback(() => {
		if (!prompt) return
		prompt.resolve(false)
		setPrompt(null)
	}, [prompt])

	/**
	 * Resolve the blocked callback only after the manager has recorded the
	 * grant — same ordering yours-wallet uses.
	 */
	const settleCore = useCallback(
		async (granted: boolean) => {
			const entry = coreQueue[0]
			const mgr = gatedRef.current
			if (!entry || !mgr) return
			const { requestID } = entry.pending.request
			try {
				if (!granted) {
					if (entry.pending.kind === 'grouped') {
						await mgr.denyGroupedPermission(requestID)
					} else if (entry.pending.kind === 'counterparty') {
						await mgr.denyCounterpartyPermission(requestID)
					} else {
						await mgr.denyPermission(requestID)
					}
					entry.reject(new Error('Permission denied by user'))
				} else if (entry.pending.kind === 'grouped') {
					await mgr.grantGroupedPermission({
						requestID,
						granted: entry.pending.request.permissions,
					})
					entry.resolve()
				} else if (entry.pending.kind === 'counterparty') {
					await mgr.grantCounterpartyPermission({
						requestID,
						granted: entry.pending.request.permissions,
					})
					entry.resolve()
				} else {
					await mgr.grantPermission({ requestID })
					entry.resolve()
				}
			} catch (err) {
				entry.reject(err instanceof Error ? err : new Error(String(err)))
			} finally {
				setCoreQueue((q) => q.slice(1))
			}
		},
		[coreQueue],
	)

	const value = useMemo(
		() => ({
			status,
			error,
			identityKey,
			gatedWallet,
			localEnabled,
			setLocalEnabled,
			adminOriginator,
			setAdminOriginator,
		}),
		[
			status,
			error,
			identityKey,
			gatedWallet,
			localEnabled,
			setLocalEnabled,
			adminOriginator,
			setAdminOriginator,
		],
	)

	return (
		<LocalCwiContext.Provider value={value}>
			{children}
			{prompt && (
				<div style={overlayStyle}>
					<div style={modalStyle}>
						<OneSatPermissionPrompt
							request={prompt.request}
							onApprove={onApprove}
							onReject={onReject}
							theme="dark"
						/>
					</div>
				</div>
			)}
			{!prompt && coreQueue.length > 0 && (
				<div style={overlayStyle}>
					<div style={modalStyle}>
						<CorePermissionPrompt
							pending={coreQueue[0].pending}
							onApprove={() => void settleCore(true)}
							onReject={() => void settleCore(false)}
						/>
						{coreQueue.length > 1 && (
							<div style={queueNoteStyle}>
								+{coreQueue.length - 1} more queued
							</div>
						)}
					</div>
				</div>
			)}
		</LocalCwiContext.Provider>
	)
}

const overlayStyle: React.CSSProperties = {
	position: 'fixed',
	inset: 0,
	background: 'rgba(0,0,0,0.65)',
	display: 'flex',
	alignItems: 'center',
	justifyContent: 'center',
	zIndex: 9999,
	padding: '1rem',
}

const modalStyle: React.CSSProperties = {
	maxWidth: 420,
	width: '100%',
	maxHeight: '90vh',
	overflow: 'auto',
}

const queueNoteStyle: React.CSSProperties = {
	marginTop: '0.5rem',
	textAlign: 'center',
	fontSize: '0.72rem',
	color: '#888',
}
