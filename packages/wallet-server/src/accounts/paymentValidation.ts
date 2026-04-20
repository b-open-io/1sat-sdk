import { Transaction, Utils, type WalletInterface } from '@bsv/sdk'

/**
 * BRC-0121 request-header names (lowercase for Headers API compatibility).
 */
export const BRC0121_HEADERS = {
	derivationPrefix: 'x-bsv-payment-derivation-prefix',
	derivationSuffix: 'x-bsv-payment-derivation-suffix',
	transaction: 'x-bsv-payment-transaction',
	orderID: 'x-bsv-payment-order-id',
	outputIndex: 'x-bsv-payment-output-index',
} as const

export interface Brc0121PaymentHeaders {
	derivationPrefix: string
	derivationSuffix: string
	beefBase64: string
	orderID?: string
	outputIndex: number
}

export function readBrc0121Headers(req: Request): Brc0121PaymentHeaders | null {
	const derivationPrefix = req.headers.get(BRC0121_HEADERS.derivationPrefix)
	const derivationSuffix = req.headers.get(BRC0121_HEADERS.derivationSuffix)
	const beefBase64 = req.headers.get(BRC0121_HEADERS.transaction)
	if (!derivationPrefix || !derivationSuffix || !beefBase64) return null

	const outIdxHeader = req.headers.get(BRC0121_HEADERS.outputIndex)
	const outputIndex = outIdxHeader ? Number.parseInt(outIdxHeader, 10) : 0
	if (!Number.isInteger(outputIndex) || outputIndex < 0) {
		throw new Brc0121PaymentError(`invalid output index: ${outIdxHeader}`)
	}

	return {
		derivationPrefix,
		derivationSuffix,
		beefBase64,
		orderID: req.headers.get(BRC0121_HEADERS.orderID) ?? undefined,
		outputIndex,
	}
}

export interface ValidatePaymentInput {
	wallet: WalletInterface
	senderIdentityKey: string
	headers: Brc0121PaymentHeaders
	expectedSatoshis: number
}

export interface ParsedPayment {
	txid: string
	beef: number[]
	satoshisAtOutput: number
	outputIndex: number
	derivationPrefix: string
	derivationSuffix: string
}

export interface ValidatePaymentResult {
	txid: string
	satoshisReceived: number
}

/**
 * Parses the BRC-0121 payment headers into a usable shape. Performs the cheap
 * checks (BEEF decode, output exists, satoshis sufficient) but does NOT touch
 * the wallet — so callers can check duplicate-txid before internalizing.
 */
export function parseBrc0121Payment(
	headers: Brc0121PaymentHeaders,
	expectedSatoshis: number,
): ParsedPayment {
	const beef = decodeBeefHeader(headers.beefBase64)
	const tx = Transaction.fromAtomicBEEF(beef)
	const txid = tx.id('hex') as string

	const targetOutput = tx.outputs[headers.outputIndex]
	if (!targetOutput) {
		throw new Brc0121PaymentError(
			`BEEF has no output at index ${headers.outputIndex}`,
		)
	}
	const satoshis = targetOutput.satoshis ?? 0
	if (satoshis < expectedSatoshis) {
		throw new Brc0121PaymentError(
			`payment output ${satoshis} sats below required ${expectedSatoshis}`,
		)
	}
	return {
		txid,
		beef,
		satoshisAtOutput: satoshis,
		outputIndex: headers.outputIndex,
		derivationPrefix: headers.derivationPrefix,
		derivationSuffix: headers.derivationSuffix,
	}
}

/**
 * Internalizes a previously-parsed BRC-29 payment into the server wallet.
 * The wallet SDK handles BEEF validation, script derivation, and UTXO
 * recording; failures throw `Brc0121PaymentError`.
 */
export async function internalizePayment(input: {
	wallet: WalletInterface
	senderIdentityKey: string
	parsed: ParsedPayment
}): Promise<ValidatePaymentResult> {
	try {
		await input.wallet.internalizeAction({
			tx: input.parsed.beef,
			outputs: [
				{
					paymentRemittance: {
						derivationPrefix: input.parsed.derivationPrefix,
						derivationSuffix: input.parsed.derivationSuffix,
						senderIdentityKey: input.senderIdentityKey,
					},
					outputIndex: input.parsed.outputIndex,
					protocol: 'wallet payment',
				},
			],
			labels: ['wallet-server', 'brc-0121'],
			description: 'BRC-0121 storage capacity payment',
		})
	} catch (err) {
		throw new Brc0121PaymentError(
			`wallet.internalizeAction rejected payment: ${err instanceof Error ? err.message : String(err)}`,
		)
	}
	return {
		txid: input.parsed.txid,
		satoshisReceived: input.parsed.satoshisAtOutput,
	}
}

/** @deprecated Use `parseBrc0121Payment` then `internalizePayment`. */
export async function validateBrc0121Payment(
	input: ValidatePaymentInput,
): Promise<ValidatePaymentResult> {
	const parsed = parseBrc0121Payment(input.headers, input.expectedSatoshis)
	return internalizePayment({
		wallet: input.wallet,
		senderIdentityKey: input.senderIdentityKey,
		parsed,
	})
}

export class Brc0121PaymentError extends Error {
	constructor(message: string) {
		super(message)
		this.name = 'Brc0121PaymentError'
	}
}

function decodeBeefHeader(value: string): number[] {
	try {
		return Utils.toArray(value, 'base64')
	} catch (err) {
		throw new Brc0121PaymentError(
			`cannot decode ${BRC0121_HEADERS.transaction} as base64: ${err instanceof Error ? err.message : String(err)}`,
		)
	}
}
