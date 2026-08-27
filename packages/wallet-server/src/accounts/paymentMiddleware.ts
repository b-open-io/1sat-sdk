/**
 * BRC-41 payment middleware, vendored from `@bsv/payment-express-middleware`
 * with one addition: an `onPaymentInternalize` hook that lets callers
 * customize the `internalizeAction` args the middleware builds (labels,
 * description, basket tags, etc).
 *
 * Upstream runs `wallet.internalizeAction` with only a hardcoded description.
 * We need the wallet-server accounts ledger to internalize with structured
 * labels (`wallet-storage-payment`, `payer:<id>`, `bytes:<n>`, `block:<n>`)
 * so `listPaymentsForPayer` can later find the record. The hook gives us
 * that insertion point without replacing the middleware wholesale.
 *
 * Keep this in sync with upstream by diffing this file against
 * `@bsv/payment-express-middleware/src/index.ts` — only the hook-related
 * additions should diverge.
 */

import {
	type AtomicBEEF,
	createNonce,
	type InternalizeActionArgs,
	Utils,
	verifyNonce,
	type WalletInterface,
} from '@bsv/sdk'
import type { NextFunction, Request, Response } from 'express'

const PAYMENT_VERSION = '1.0'

export interface BsvPayment {
	derivationPrefix: string
	derivationSuffix: string
	transaction: unknown
}

/** Default args the middleware would internalize with if no hook is provided. */
export interface DefaultInternalizeArgs {
	tx: AtomicBEEF
	outputs: NonNullable<InternalizeActionArgs['outputs']>
	description: string
}

export interface AccountsPaymentMiddlewareOptions {
	wallet: WalletInterface
	/** Returns the sats owed for this request. 0 = pass through, no payment. */
	calculateRequestPrice?: (req: Request) => number | Promise<number>
	/**
	 * Called just before `wallet.internalizeAction`. Receives the default
	 * args the middleware would have used and must return the args to
	 * actually use (merge or override). Useful for attaching labels, custom
	 * descriptions, basket tags, etc.
	 */
	onPaymentInternalize?: (
		req: Request,
		defaults: DefaultInternalizeArgs,
	) => InternalizeActionArgs | Promise<InternalizeActionArgs>
}

export function createAccountsPaymentMiddleware(
	options: AccountsPaymentMiddlewareOptions,
): (req: Request, res: Response, next: NextFunction) => Promise<void> {
	const {
		wallet,
		calculateRequestPrice = () => 100,
		onPaymentInternalize,
	} = options

	if (typeof calculateRequestPrice !== 'function') {
		throw new Error('calculateRequestPrice must be a function.')
	}
	if (wallet === undefined || typeof wallet !== 'object') {
		throw new Error(
			'A valid wallet must be supplied to the payment middleware.',
		)
	}

	return async (req: Request, res: Response, next: NextFunction) => {
		const authedReq = req as Request & { auth?: { identityKey?: string } }
		if (
			authedReq.auth === undefined ||
			typeof authedReq.auth.identityKey !== 'string'
		) {
			res.status(500).json({
				status: 'error',
				code: 'ERR_SERVER_MISCONFIGURED',
				description:
					'The payment middleware must be executed after the Auth middleware.',
			})
			return
		}

		let requestPrice: number
		try {
			requestPrice = await calculateRequestPrice(req)
		} catch (err) {
			console.error('[accounts-payment] calculateRequestPrice failed', err)
			res.status(500).json({
				status: 'error',
				code: 'ERR_PAYMENT_INTERNAL',
				description:
					'An internal error occurred while determining the payment required.',
			})
			return
		}

		if (requestPrice === 0) {
			;(req as Request & { payment?: unknown }).payment = { satoshisPaid: 0 }
			return next()
		}

		const bsvPaymentHeader = req.headers['x-bsv-payment']
		if (bsvPaymentHeader === undefined) {
			const derivationPrefix = await createNonce(wallet)
			res
				.status(402)
				.set({
					'x-bsv-payment-version': PAYMENT_VERSION,
					'x-bsv-payment-satoshis-required': String(requestPrice),
					'x-bsv-payment-derivation-prefix': derivationPrefix,
				})
				.json({
					status: 'error',
					code: 'ERR_PAYMENT_REQUIRED',
					satoshisRequired: requestPrice,
					description:
						'A BSV payment is required. Retry with the X-BSV-Payment header.',
				})
			return
		}

		let paymentData: BsvPayment
		try {
			paymentData = JSON.parse(String(bsvPaymentHeader))
		} catch {
			console.warn(
				`[accounts-payment] malformed x-bsv-payment header from ${authedReq.auth.identityKey}`,
			)
			res.status(400).json({
				status: 'error',
				code: 'ERR_MALFORMED_PAYMENT',
				description: 'The X-BSV-Payment header is not valid JSON.',
			})
			return
		}
		try {
			const valid = await verifyNonce(paymentData.derivationPrefix, wallet)
			if (!valid) throw new Error('invalid nonce')
		} catch {
			console.warn(
				`[accounts-payment] invalid derivation prefix from ${authedReq.auth.identityKey}`,
			)
			res.status(400).json({
				status: 'error',
				code: 'ERR_INVALID_DERIVATION_PREFIX',
				description: 'The X-BSV-Payment-Derivation-Prefix is not valid.',
			})
			return
		}

		const defaults: DefaultInternalizeArgs = {
			tx: Utils.toArray(paymentData.transaction, 'base64') as AtomicBEEF,
			outputs: [
				{
					paymentRemittance: {
						derivationPrefix: paymentData.derivationPrefix,
						derivationSuffix: paymentData.derivationSuffix,
						senderIdentityKey: authedReq.auth.identityKey,
					},
					outputIndex: 0,
					protocol: 'wallet payment',
				},
			],
			description: 'Payment for request',
		}

		const internalizeArgs: InternalizeActionArgs = onPaymentInternalize
			? await onPaymentInternalize(req, defaults)
			: defaults

		try {
			const { accepted } = await wallet.internalizeAction(internalizeArgs)
			;(req as Request & { payment?: unknown }).payment = {
				satoshisPaid: requestPrice,
				accepted,
				tx: paymentData.transaction,
			}
			res.set({ 'x-bsv-payment-satoshis-paid': String(requestPrice) })
			next()
		} catch (err) {
			const code = (err as { code?: string })?.code ?? 'ERR_PAYMENT_FAILED'
			const description =
				(err as { message?: string })?.message ?? 'Payment failed.'
			console.error(
				`[accounts-payment] internalize failed for ${authedReq.auth.identityKey}: ${code} ${description}`,
			)
			res.status(400).json({ status: 'error', code, description })
		}
	}
}
