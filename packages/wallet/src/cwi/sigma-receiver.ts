import type { WalletInterface } from '@bsv/sdk'
import { handleCWIRequest } from './receiver'
import {
	type CWIRequestMessage,
	type CWIResponseMessage,
	isCWIEventName,
} from './types'

export interface SigmaCustomMessage {
	type: string
	payload: unknown
	origin: string
}

export interface SigmaCWIReceiverConfig {
	allowedOrigins: string[]
	target?: EventTarget
	/** Optional handler for non-CWI messages (e.g. SET_IDENTITY). */
	onCustomMessage?: (message: SigmaCustomMessage) => void
}

export interface SigmaCWIReceiver {
	dispose: () => void
}

const isCWIRequest = (v: unknown): v is CWIRequestMessage => {
	if (typeof v !== 'object' || v === null) return false
	const r = v as Record<string, unknown>
	return (
		r.type === 'CWI' &&
		r.isInvocation === true &&
		typeof r.id === 'string' &&
		typeof r.call === 'string'
	)
}

const isCustom = (v: unknown): v is { type: string; payload: unknown } => {
	if (typeof v !== 'object' || v === null) return false
	const r = v as Record<string, unknown>
	return typeof r.type === 'string' && r.type !== 'CWI'
}

export const createSigmaCWIReceiver = (
	wallet: WalletInterface,
	config: SigmaCWIReceiverConfig,
): SigmaCWIReceiver => {
	const allowed = new Set(config.allowedOrigins)
	const target = config.target ?? (globalThis as unknown as EventTarget)

	const onMessage = async (event: Event) => {
		const msg = event as MessageEvent
		if (!allowed.has(msg.origin)) return

		if (isCWIRequest(msg.data)) {
			if (!isCWIEventName(msg.data.call)) return
			const response = await handleCWIRequest(wallet, {
				action: msg.data.call,
				params: msg.data.args,
				originator: msg.origin,
				id: msg.data.id,
			})
			const envelope: CWIResponseMessage = response.ok
				? {
						type: 'CWI',
						isInvocation: false,
						id: msg.data.id,
						result: response.data,
					}
				: {
						type: 'CWI',
						isInvocation: false,
						id: msg.data.id,
						status: 'error',
						description: response.error.message,
					}
			const source = msg.source as {
				postMessage?: (d: unknown, o: string) => void
			} | null
			source?.postMessage?.(envelope, msg.origin)
			return
		}

		if (isCustom(msg.data) && config.onCustomMessage) {
			config.onCustomMessage({
				type: msg.data.type,
				payload: msg.data.payload,
				origin: msg.origin,
			})
		}
	}

	target.addEventListener('message', onMessage as EventListener)
	return {
		dispose: () =>
			target.removeEventListener('message', onMessage as EventListener),
	}
}
