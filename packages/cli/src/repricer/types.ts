export interface BsvUsdQuote {
	bsvUsd: number
	timestamp: number
	source: string
}

export interface RateProvider {
	readonly name: string
	getBsvUsd(): Promise<BsvUsdQuote>
}

export interface RepricerBounds {
	/** Reject moves larger than this percent. */
	maxMovePct: number
	/** Floor for the new sats value. */
	minSats: number
}

export interface ComputeRepriceInput {
	targetUsd: number
	bsvUsd: number
	currentSats: number
	bounds: RepricerBounds
}

export type ComputeRepriceResult =
	| { status: 'ok'; newSats: number }
	| { status: 'skipped'; reason: string }
