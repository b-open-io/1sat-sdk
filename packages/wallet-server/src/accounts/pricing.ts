import type { AccountsConfig } from './types'

/** Minimal payment view needed for pricing math. */
export interface PaymentForPricing {
	bytesCovered: number
	paidThroughBlock: number
}

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
	currentPayment: PaymentForPricing | undefined
	currentBlock: number
	config: Pick<
		AccountsConfig,
		'baselineBytes' | 'purchaseUnitBytes' | 'satsPerUnit' | 'durationBlocks'
	>
}

export interface RefundedQuote {
	/** Total paid capacity (in bytes, rounded up to a whole purchase unit) to be purchased. */
	bytesCovered: number
	unitsCharged: number
	/** Price at full rate for `unitsCharged` over `durationBlocks`. */
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

	const unitsCharged = Math.max(
		1,
		Math.ceil(neededPaidBytes / input.config.purchaseUnitBytes),
	)
	const bytesCovered = unitsCharged * input.config.purchaseUnitBytes
	const fullSats = unitsCharged * input.config.satsPerUnit

	const refundSats = refundCreditSats(
		activePayment,
		input.currentBlock,
		input.config.durationBlocks,
		input.config.purchaseUnitBytes,
		input.config.satsPerUnit,
	)

	const chargeSats = Math.max(0, fullSats - refundSats)
	const paidThroughBlock = input.currentBlock + input.config.durationBlocks

	return {
		bytesCovered,
		unitsCharged,
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
	payment: PaymentForPricing | undefined,
	currentBlock: number,
	durationBlocks: number,
	purchaseUnitBytes: number,
	satsPerUnit: number,
): number {
	if (!payment) return 0
	const remaining = payment.paidThroughBlock - currentBlock
	if (remaining <= 0) return 0
	const units = Math.max(1, Math.ceil(payment.bytesCovered / purchaseUnitBytes))
	return Math.floor((units * satsPerUnit * remaining) / durationBlocks)
}

export { BYTES_PER_GB }
