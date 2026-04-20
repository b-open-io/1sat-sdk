import type { AccountsConfig, Payment } from './types'

const BYTES_PER_GB = 1_073_741_824 // 1024^3

export interface CapacityInput {
	baselineBytes: number
	paidBytes: number
	usedBytes: number
}

export interface CapacityResult {
	baselineBytes: number
	paidBytes: number
	capacityBytes: number
	usedBytes: number
	deficitBytes: number
}

export function computeCapacity(input: CapacityInput): CapacityResult {
	const capacityBytes = input.baselineBytes + input.paidBytes
	const deficitBytes = Math.max(0, input.usedBytes - capacityBytes)
	return {
		baselineBytes: input.baselineBytes,
		paidBytes: input.paidBytes,
		capacityBytes,
		usedBytes: input.usedBytes,
		deficitBytes,
	}
}

export interface RefundedQuoteInput {
	usedBytes: number
	currentPayment: Payment | undefined
	currentBlock: number
	config: Pick<AccountsConfig, 'baselineBytes' | 'satsPerGb' | 'durationBlocks'>
}

export interface RefundedQuote {
	/** Total paid capacity (in bytes, rounded up to GB) to be purchased. */
	bytesCovered: number
	gigabytesCharged: number
	/** Price at full rate for `gigabytesCharged` over `durationBlocks`. */
	fullSats: number
	/** Credit for unused time remaining on the caller's current payment. */
	refundSats: number
	/** Sats owed after applying refund (never negative). */
	chargeSats: number
	/** Block height at which the new payment will expire. */
	paidThroughBlock: number
}

/**
 * Computes a single quote under the "full charge minus refund credit" model.
 *
 * The caller pays the full price for whatever paid capacity they need beyond
 * baseline, for a fresh `durationBlocks` period. Any unused time remaining on
 * their prior payment is prorated and subtracted from the charge.
 *
 * A new payment fully supersedes the prior one — the new paidThroughBlock
 * becomes the account's active expiry.
 */
export function quoteRefundedCharge(
	input: RefundedQuoteInput,
): RefundedQuote | undefined {
	const activePayment =
		input.currentPayment &&
		input.currentPayment.paidThroughBlock > input.currentBlock
			? input.currentPayment
			: undefined

	const neededPaidBytes = Math.max(
		0,
		input.usedBytes - input.config.baselineBytes,
	)
	if (neededPaidBytes <= (activePayment?.bytesCovered ?? 0)) {
		return undefined
	}

	const gigabytesCharged = Math.max(
		1,
		Math.ceil(neededPaidBytes / BYTES_PER_GB),
	)
	const bytesCovered = gigabytesCharged * BYTES_PER_GB
	const fullSats = gigabytesCharged * input.config.satsPerGb

	const refundSats = refundCreditSats(
		input.currentPayment,
		input.currentBlock,
		input.config.durationBlocks,
		input.config.satsPerGb,
	)

	const chargeSats = Math.max(0, fullSats - refundSats)
	const paidThroughBlock = input.currentBlock + input.config.durationBlocks

	return {
		bytesCovered,
		gigabytesCharged,
		fullSats,
		refundSats,
		chargeSats,
		paidThroughBlock,
	}
}

/**
 * Prorated credit for the unused time remaining on a prior payment.
 * Returns 0 when no prior payment or when it has already expired.
 */
export function refundCreditSats(
	payment: Payment | undefined,
	currentBlock: number,
	durationBlocks: number,
	satsPerGb: number,
): number {
	if (!payment) return 0
	const remaining = payment.paidThroughBlock - currentBlock
	if (remaining <= 0) return 0
	const gb = Math.max(1, Math.ceil(payment.bytesCovered / BYTES_PER_GB))
	return Math.floor((gb * satsPerGb * remaining) / durationBlocks)
}

export { BYTES_PER_GB }
