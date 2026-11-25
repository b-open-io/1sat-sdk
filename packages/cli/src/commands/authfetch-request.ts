import { AuthFetch, type WalletInterface } from '@bsv/sdk'

class PaymentRequired extends Error {
	constructor(readonly satoshis: number) {
		super('Payment requires approval')
	}
}

/** Enforce approval at the wallet boundary; SDK retry=0 does not disable payment. */
export function createApprovalAuth(wallet: WalletInterface) {
	let approved: false | number | true = false
	let submitted = false
	let currentRequest: { retryCounter?: number } | undefined
	const guarded = new Proxy(wallet, {
		get(target, property) {
			if (property === 'createAction')
				return async (...args: Parameters<WalletInterface['createAction']>) => {
					const satoshis =
						args[0].outputs?.reduce(
							(sum, output) => sum + output.satoshis,
							0,
						) ?? 0
					if (!Number.isSafeInteger(satoshis) || satoshis <= 0)
						throw new Error('Invalid HTTP payment amount')
					if (approved === false) throw new PaymentRequired(satoshis)
					if (typeof approved === 'number' && satoshis !== approved)
						throw new Error(
							'Payment amount changed; review the new quote before retrying',
						)
					if (submitted)
						throw new Error(
							'Payment already submitted; reconcile wallet activity before retrying',
						)
					submitted = true
					const result = await target.createAction(...args)
					// A verified 402 reached the approved wallet boundary. Permit its
					// one paid send, but not stale-session replay of that send.
					if (currentRequest?.retryCounter === 0)
						currentRequest.retryCounter = 1
					return result
				}
			if (property === 'signAction')
				return async () => {
					throw new Error('Unexpected HTTP payment signing request')
				}
			const value = Reflect.get(target, property, target)
			return typeof value === 'function' ? value.bind(target) : value
		},
	})
	return {
		auth: new AuthFetch(guarded),
		prepareRequest: (config: { retryCounter?: number }) => {
			currentRequest = config
		},
		authorizePayment: (satoshis?: number) => {
			approved = satoshis ?? true
		},
	}
}

export interface PaymentApprovalRequired {
	error: 'approval_required'
	status: 402
	ok: false
	message: string
	satoshis?: number
}

/** Keep request replay and payment decisions separate from wallet setup/output. */
export async function requestWithApproval(
	url: string,
	init: RequestInit & { method: string },
	options: { yes?: boolean; interactive: boolean },
	dependencies: {
		auth: Pick<AuthFetch, 'fetch'>
		plainFetch: typeof fetch
		confirmPayment: (message: string) => Promise<boolean>
		authorizePayment?: (satoshis?: number) => void
		prepareRequest?: (config: { retryCounter?: number }) => void
	},
): Promise<Response | PaymentApprovalRequired> {
	const send = () => {
		const config = {
			...init,
			paymentRetryAttempts: 1,
			...(init.method === 'GET' || init.method === 'HEAD'
				? {}
				: { retryCounter: 1 }),
		}
		dependencies.prepareRequest?.(config)
		return dependencies.auth.fetch(url, config)
	}
	let res: Response
	try {
		res = await send()
	} catch (error) {
		if (error instanceof PaymentRequired) {
			res = new Response(null, {
				status: 402,
				headers: { 'x-bsv-payment-satoshis-required': String(error.satoshis) },
			})
		} else {
			// Match only the SDK's known unauthenticated-response error, not
			// transport, signature verification, or other authentication failures.
			const missingAuthentication =
				error instanceof Error &&
				/^Received HTTP \d{3}(?: [^\n]*)? from /.test(error.message) &&
				(error.message.includes(
					` from ${url} without valid BSV authentication (missing headers: `,
				) ||
					error.message.includes(
						` from ${url} without valid BSV authentication (response lacked required BSV auth headers)`,
					))
			if (!missingAuthentication) throw error
			if (init.method !== 'GET' && init.method !== 'HEAD') {
				throw new Error(
					'Authentication could not be verified. The request outcome may be unknown; verify activity before retrying.',
					{ cause: error },
				)
			}
			res = await dependencies.plainFetch(url, init)
		}
	}

	if (res.status !== 402) return res

	const amount = res.headers.get('x-bsv-payment-satoshis-required')
	const value =
		amount !== null && /^\d{1,16}$/.test(amount) ? Number(amount) : Number.NaN
	const satoshis = Number.isSafeInteger(value) ? value : undefined
	const message =
		satoshis !== undefined
			? `Pay ${satoshis} sats for ${init.method} ${url}?`
			: `Server requires payment (402) for ${init.method} ${url}. Continue?`
	if (!options.yes) {
		if (!options.interactive) {
			return {
				error: 'approval_required',
				status: 402,
				ok: false,
				message:
					'Payment requires approval. Review the payment and rerun with --yes to authorize it, or run in an interactive terminal.',
				...(satoshis !== undefined ? { satoshis } : {}),
			}
		}
		if (!(await dependencies.confirmPayment(message))) {
			throw new Error('Payment cancelled.')
		}
	}
	dependencies.authorizePayment?.(satoshis)
	return send()
}
