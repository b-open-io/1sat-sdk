import type { WalletInterface } from '@bsv/sdk'
import { handleCWIRequest } from './receiver'
import {
	type CWIRequestMessage,
	type CWIResponseMessage,
	isCWIEventName,
} from './types'

export interface WebCWIReceiverConfig {
	/** Host origins permitted to send requests. Required for safety. */
	allowedOrigins: string[]
	/** EventTarget to listen on. Defaults to globalThis. */
	target?: EventTarget
}

export interface WebCWIReceiver {
	dispose: () => void
}

const isRequest = (v: unknown): v is CWIRequestMessage => {
	if (typeof v !== 'object' || v === null) return false
	const r = v as Record<string, unknown>
	return (
		r.type === 'CWI' &&
		r.isInvocation === true &&
		typeof r.id === 'string' &&
		typeof r.call === 'string'
	)
}

export const createWebCWIReceiver = (
	wallet: WalletInterface,
	config: WebCWIReceiverConfig,
): WebCWIReceiver => {
	const allowed = new Set(config.allowedOrigins)
	const target = config.target ?? (globalThis as unknown as EventTarget)

	const onMessage = async (event: Event) => {
		const msg = event as MessageEvent
		if (!allowed.has(msg.origin)) return
		if (!isRequest(msg.data)) return
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
	}

	target.addEventListener('message', onMessage as EventListener)
	return {
		dispose: () =>
			target.removeEventListener('message', onMessage as EventListener),
	}
}
