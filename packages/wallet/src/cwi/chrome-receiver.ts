import type { WalletInterface } from '@bsv/sdk'
import { handleCWIRequest } from './receiver'
import { isCWIEventName } from './types'

type SendResponse = (response: unknown) => void
type Listener = (
	msg: unknown,
	sender: unknown,
	sendResponse: SendResponse,
) => boolean

interface ChromeRuntimeMessage {
	action?: unknown
	params?: unknown
	originator?: unknown
}

export interface ChromeCWIReceiver {
	dispose: () => void
}

const isMessage = (v: unknown): v is ChromeRuntimeMessage =>
	typeof v === 'object' && v !== null && 'action' in v

export const createChromeCWIReceiver = (
	wallet: WalletInterface,
): ChromeCWIReceiver => {
	const api = (
		globalThis as unknown as {
			chrome?: {
				runtime?: {
					onMessage?: {
						addListener: (l: Listener) => void
						removeListener: (l: Listener) => void
					}
				}
			}
		}
	).chrome
	const onMessage = api?.runtime?.onMessage
	if (!onMessage) {
		throw new Error(
			'createChromeCWIReceiver: chrome.runtime.onMessage unavailable',
		)
	}

	const listener: Listener = (msg, _sender, sendResponse) => {
		if (!isMessage(msg)) return false
		if (!isCWIEventName(msg.action)) return false

		void handleCWIRequest(wallet, {
			action: msg.action,
			params: msg.params,
			originator:
				typeof msg.originator === 'string' ? msg.originator : undefined,
		}).then((response) => {
			sendResponse(
				response.ok
					? { success: true, data: response.data }
					: { success: false, error: response.error.message },
			)
		})

		return true
	}

	onMessage.addListener(listener)
	return {
		dispose: () => onMessage.removeListener(listener),
	}
}
