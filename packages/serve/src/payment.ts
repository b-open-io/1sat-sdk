import {
	type AtomicBEEF,
	type InternalizeActionArgs,
	P2PKH,
	PublicKey,
	Transaction,
	Utils,
	type WalletInterface,
	type WalletProtocol,
	createNonce,
	verifyNonce,
} from '@bsv/sdk'
import type { AuthContext, AuthHandler } from './transport.js'

/** BRC-29 protocol ID for wallet payments (matches @1sat/types). */
const BRC29_PROTOCOL_ID: WalletProtocol = [2, '3241645161d8']
const PAYMENT_VERSION = '1.0'

/** A payment verified against the server-derived BRC-29 script. */
export interface VerifiedPayment {
	/** The payment transaction as AtomicBEEF bytes. */
	tx: number[]
	/** Index of the output that pays the server. */
	outputIndex: number
	/** Satoshis on that output. */
	satoshis: number
	derivationPrefix: string
	derivationSuffix: string
	/** The paying peer's identity key. */
	senderIdentityKey: string
}

/** The context a paid handler receives — the auth context plus the payment. */
export interface PaidContext extends AuthContext {
	payment: VerifiedPayment
}

export type PaidHandler = (ctx: PaidContext) => Promise<Response> | Response

/**
 * Decides how the verified payment is recorded. Receives the default
 * 'wallet payment' internalize args (general balance) and returns the args to
 * actually use — e.g. a 'basket insertion' with tags. Defaults to the wallet
 * payment when omitted.
 */
export type OnInternalize = (
	payment: VerifiedPayment,
	defaults: InternalizeActionArgs,
) => InternalizeActionArgs | Promise<InternalizeActionArgs>

export interface WithPaymentOptions {
	/** Server wallet that issued the auth session; also records the payment. */
	wallet: WalletInterface
	/** Flat price, or a per-request price function. */
	price: number | ((ctx: AuthContext) => number | Promise<number>)
	/** Optional hook to redirect the internalize (e.g. into a basket). */
	onInternalize?: OnInternalize
	/** Action-level description recorded with the internalize (5..50 chars). */
	description?: string
}

interface PaymentHeader {
	derivationPrefix: string
	derivationSuffix: string
	transaction: string
}

/**
 * Wraps a handler behind the BRC-105 payment flow. Wire-identical to
 * `@bsv/payment-express-middleware`: an unpaid request gets a 402 with a
 * derivation-prefix nonce; the paid retry is verified against the
 * server-derived BRC-29 script and internalized (via `onInternalize`) before
 * the wrapped handler runs. The buyer identity comes from the auth layer.
 */
export function withPayment(
	options: WithPaymentOptions,
	handler: PaidHandler,
): AuthHandler {
	const { wallet, onInternalize } = options
	return async (ctx: AuthContext): Promise<Response> => {
		if (ctx.identityKey === 'unknown') {
			return json(401, {
				status: 'error',
				description: 'identity required for payment',
			})
		}
		const price =
			typeof options.price === 'function'
				? await options.price(ctx)
				: options.price

		const rawPayment = ctx.request.headers.get('x-bsv-payment')
		if (!rawPayment) {
			const derivationPrefix = await createNonce(wallet)
			return new Response(
				JSON.stringify({
					status: 'error',
					code: 'ERR_PAYMENT_REQUIRED',
					satoshisRequired: price,
					description: `A payment of ${price} satoshis is required.`,
				}),
				{
					status: 402,
					headers: {
						'content-type': 'application/json',
						'x-bsv-payment-version': PAYMENT_VERSION,
						'x-bsv-payment-satoshis-required': String(price),
						'x-bsv-payment-derivation-prefix': derivationPrefix,
					},
				},
			)
		}

		let pay: PaymentHeader
		try {
			pay = JSON.parse(rawPayment) as PaymentHeader
		} catch {
			return json(400, {
				status: 'error',
				description: 'malformed x-bsv-payment header',
			})
		}

		let validNonce = false
		try {
			validNonce = await verifyNonce(pay.derivationPrefix, wallet)
		} catch {
			validNonce = false
		}
		if (!validNonce) {
			return json(400, {
				status: 'error',
				code: 'ERR_INVALID_DERIVATION_PREFIX',
				description: 'derivation prefix is not a nonce we issued',
			})
		}

		let verified: VerifiedPayment
		try {
			verified = await verifyPayment(wallet, ctx.identityKey, pay, price)
		} catch (err) {
			return json(400, {
				status: 'error',
				code: 'ERR_PAYMENT_INVALID',
				description: err instanceof Error ? err.message : String(err),
			})
		}

		const defaults: InternalizeActionArgs = {
			tx: verified.tx as AtomicBEEF,
			outputs: [
				{
					outputIndex: verified.outputIndex,
					protocol: 'wallet payment',
					paymentRemittance: {
						derivationPrefix: verified.derivationPrefix,
						derivationSuffix: verified.derivationSuffix,
						senderIdentityKey: verified.senderIdentityKey,
					},
				},
			],
			description: (options.description ?? 'payment for request').slice(0, 50),
		}
		try {
			await wallet.internalizeAction(
				onInternalize ? await onInternalize(verified, defaults) : defaults,
			)
		} catch (err) {
			return json(400, {
				status: 'error',
				code: 'ERR_PAYMENT_FAILED',
				description: err instanceof Error ? err.message : String(err),
			})
		}

		const response = await handler({ ...ctx, payment: verified })
		const buf = await response.arrayBuffer()
		const headers = new Headers(response.headers)
		headers.set('x-bsv-payment-satoshis-paid', String(verified.satoshis))
		return new Response(buf, { status: response.status, headers })
	}
}

/**
 * Verifies the paid output: re-derives the BRC-29 P2PKH script from the buyer
 * key + derivation and confirms an output pays it for at least `price`. This
 * is the check `internalizeAction` performs for 'wallet payment' but skips for
 * 'basket insertion', so we do it ourselves.
 */
async function verifyPayment(
	wallet: WalletInterface,
	senderIdentityKey: string,
	pay: PaymentHeader,
	price: number,
): Promise<VerifiedPayment> {
	const { publicKey } = await wallet.getPublicKey({
		protocolID: BRC29_PROTOCOL_ID,
		keyID: `${pay.derivationPrefix} ${pay.derivationSuffix}`,
		counterparty: senderIdentityKey,
		forSelf: true,
	})
	const expectedScript = new P2PKH()
		.lock(PublicKey.fromString(publicKey).toAddress())
		.toHex()

	const txBytes = Utils.toArray(pay.transaction, 'base64')
	const tx = Transaction.fromAtomicBEEF(txBytes)
	for (let i = 0; i < tx.outputs.length; i++) {
		const out = tx.outputs[i]
		if (
			out?.lockingScript.toHex() === expectedScript &&
			(out.satoshis ?? 0) >= price
		) {
			return {
				tx: txBytes,
				outputIndex: i,
				satoshis: out.satoshis ?? 0,
				derivationPrefix: pay.derivationPrefix,
				derivationSuffix: pay.derivationSuffix,
				senderIdentityKey,
			}
		}
	}
	throw new Error('no output pays the derived script for the required amount')
}

function json(status: number, body: unknown): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json' },
	})
}
