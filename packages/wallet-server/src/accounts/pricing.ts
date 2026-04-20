import type { AccountsConfig } from './types'

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

/**
 * Given a byte deficit and a `satsPerGb` rate, compute the sats required to
 * cover the deficit (rounded up at GB granularity).
 */
export function priceForDeficit(
	deficitBytes: number,
	satsPerGb: number,
): {
	satoshisRequired: number
	gigabytesCharged: number
	bytesCovered: number
} {
	if (deficitBytes <= 0) {
		return { satoshisRequired: 0, gigabytesCharged: 0, bytesCovered: 0 }
	}
	const gigabytesCharged = Math.ceil(deficitBytes / BYTES_PER_GB)
	return {
		satoshisRequired: gigabytesCharged * satsPerGb,
		gigabytesCharged,
		bytesCovered: gigabytesCharged * BYTES_PER_GB,
	}
}

export function quoteForAccount(
	config: AccountsConfig,
	capacity: CapacityResult,
): {
	satoshisRequired: number
	bytesCovered: number
} {
	return priceForDeficit(capacity.deficitBytes, config.satsPerGb)
}

export { BYTES_PER_GB }
