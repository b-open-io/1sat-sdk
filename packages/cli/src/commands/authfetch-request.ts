import type { AuthFetch } from '@bsv/sdk'

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
	},
): Promise<Response | PaymentApprovalRequired> {
	let res: Response
	try {
		res = await dependencies.auth.fetch(url, {
			...init,
			paymentRetryAttempts: 0,
		})
	} catch (error) {
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
	return dependencies.auth.fetch(url, init)
}
