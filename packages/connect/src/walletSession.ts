import type { WalletInterface } from '@bsv/sdk'
import EventEmitter from 'eventemitter3'
import type { ConnectWalletResult } from './connectWallet'

export type WalletSessionStatus = 'connected' | 'disconnected'

export type DisconnectReason = 'unauthenticated' | 'unavailable' | 'manual'

export interface WalletSessionOptions {
	/** How often to check auth + identity. Default 4000ms. */
	pollIntervalMs?: number
}

export interface IdentityChangeEvent {
	previous: string
	next: string
}

export interface DisconnectedEvent {
	reason: DisconnectReason
}

export interface WalletSession {
	readonly wallet: WalletInterface | null
	readonly identityKey: string | null
	readonly status: WalletSessionStatus
	readonly provider: string | null
	readonly disconnectReason: DisconnectReason | null

	/** Start the poll loop (idempotent). No-op if already disconnected. */
	start(): void
	/** Stop polling without clearing session state. */
	stop(): void
	/** Stop polling, call provider disconnect, clear session, emit disconnected. */
	disconnect(reason?: DisconnectReason): void

	on(
		event: 'identityChange',
		handler: (e: IdentityChangeEvent) => void,
	): () => void
	on(event: 'disconnected', handler: (e: DisconnectedEvent) => void): () => void
	on(
		event: 'status',
		handler: (status: WalletSessionStatus) => void,
	): () => void
}

const DEFAULT_POLL_INTERVAL_MS = 4000

/**
 * Holds a connected BRC-100 wallet and watches for identity / auth changes.
 *
 * Polling is gated on `isAuthenticated` so a locked wallet does not trigger
 * unlock popups via `getPublicKey`. When auth is lost or the substrate fails,
 * the session disconnects and emits `disconnected`.
 */
export function createWalletSession(
	result: Pick<
		ConnectWalletResult,
		'wallet' | 'identityKey' | 'provider' | 'disconnect'
	>,
	options?: WalletSessionOptions,
): WalletSession {
	const pollIntervalMs = options?.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS
	const events = new EventEmitter()
	const providerDisconnect = result.disconnect

	let wallet: WalletInterface | null = result.wallet
	let identityKey: string | null = result.identityKey
	let status: WalletSessionStatus = 'connected'
	let disconnectReason: DisconnectReason | null = null
	const provider = result.provider

	let timer: ReturnType<typeof setInterval> | null = null
	let inFlight = false
	let generation = 0

	function setStatus(next: WalletSessionStatus): void {
		if (status === next) return
		status = next
		events.emit('status', next)
	}

	function stopPolling(): void {
		if (timer !== null) {
			clearInterval(timer)
			timer = null
		}
		generation += 1
	}

	async function tick(gen: number): Promise<void> {
		if (gen !== generation || status !== 'connected' || !wallet || inFlight) {
			return
		}
		inFlight = true
		try {
			const auth = await wallet.isAuthenticated({})
			if (gen !== generation || status !== 'connected') return

			if (!auth.authenticated) {
				endSession('unauthenticated')
				return
			}

			const { publicKey } = await wallet.getPublicKey({ identityKey: true })
			if (gen !== generation || status !== 'connected') return

			if (publicKey && publicKey !== identityKey) {
				const previous = identityKey!
				identityKey = publicKey
				events.emit('identityChange', {
					previous,
					next: publicKey,
				} satisfies IdentityChangeEvent)
			}
		} catch {
			if (gen !== generation || status !== 'connected') return
			endSession('unavailable')
		} finally {
			inFlight = false
		}
	}

	function endSession(reason: DisconnectReason): void {
		if (status === 'disconnected') return

		stopPolling()
		disconnectReason = reason
		setStatus('disconnected')

		const w = wallet
		wallet = null
		identityKey = null

		try {
			providerDisconnect()
		} catch {
			// Provider cleanup is best-effort.
		}

		// Drop reference so accidental use after disconnect is obvious.
		void w

		events.emit('disconnected', { reason } satisfies DisconnectedEvent)
	}

	const session: WalletSession = {
		get wallet() {
			return wallet
		},
		get identityKey() {
			return identityKey
		},
		get status() {
			return status
		},
		get provider() {
			return provider
		},
		get disconnectReason() {
			return disconnectReason
		},

		start() {
			if (status !== 'connected' || timer !== null) return
			const gen = generation
			timer = setInterval(() => {
				void tick(gen)
			}, pollIntervalMs)
		},

		stop() {
			stopPolling()
		},

		disconnect(reason: DisconnectReason = 'manual') {
			endSession(reason)
		},

		on(event, handler) {
			events.on(event, handler as (...args: unknown[]) => void)
			return () => {
				events.off(event, handler as (...args: unknown[]) => void)
			}
		},
	}

	return session
}
