import type { ComputeRepriceInput, ComputeRepriceResult } from './types.js'

const SATS_PER_BSV = 100_000_000

export function computeReprice(
	input: ComputeRepriceInput,
): ComputeRepriceResult {
	const { targetUsd, bsvUsd, currentSats, bounds } = input

	if (!(targetUsd > 0))
		return { status: 'skipped', reason: 'targetUsd must be > 0' }
	if (!(bsvUsd > 0)) return { status: 'skipped', reason: 'bsvUsd must be > 0' }
	if (!(currentSats > 0))
		return { status: 'skipped', reason: 'currentSats must be > 0' }

	const newSats = Math.round((targetUsd / bsvUsd) * SATS_PER_BSV)

	if (newSats < bounds.minSats) {
		return {
			status: 'skipped',
			reason: `computed ${newSats} is below minSats ${bounds.minSats}`,
		}
	}

	const movePct = (Math.abs(newSats - currentSats) / currentSats) * 100
	if (movePct > bounds.maxMovePct) {
		return {
			status: 'skipped',
			reason: `move ${movePct.toFixed(2)}% exceeds maxMovePct ${bounds.maxMovePct}`,
		}
	}

	return { status: 'ok', newSats }
}
