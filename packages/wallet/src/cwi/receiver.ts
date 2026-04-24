import type { WalletInterface } from '@bsv/sdk'
import { type CWIRequest, type CWIResponse, isCWIEventName } from './types'

export const handleCWIRequest = async <T = unknown>(
	wallet: WalletInterface,
	request: CWIRequest,
): Promise<CWIResponse<T>> => {
	const { action, params, originator, id } = request

	if (!isCWIEventName(action)) {
		return {
			ok: false,
			id,
			error: {
				code: 'UNKNOWN_ACTION',
				message: `Unknown CWI action: ${String(action)}`,
			},
		}
	}

	const method = (wallet as unknown as Record<string, unknown>)[action]
	if (typeof method !== 'function') {
		return {
			ok: false,
			id,
			error: {
				code: 'METHOD_NOT_IMPLEMENTED',
				message: `Wallet does not implement ${action}`,
			},
		}
	}

	try {
		const data = await (
			method as (args: unknown, originator?: string) => Promise<unknown>
		).call(wallet, params, originator)
		return { ok: true, id, data: data as T }
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err)
		return { ok: false, id, error: { message } }
	}
}
