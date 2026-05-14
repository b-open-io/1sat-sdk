import { computeReprice } from './computeReprice'
import type { RateProvider, RepricerBounds } from './types'

export interface PriceUpdateTaskOptions {
	monitor: unknown
	rateProvider: RateProvider
	/** Interval between successful tick attempts. */
	intervalMs: number
	/** USD target per purchase unit. Task no-ops when this is 0. */
	targetUsd: number
	bounds: RepricerBounds
	/** Read current `satsPerUnit` (typically from disk via the same loader the servers use). */
	readCurrentSats: () => number
	/** Persist the new `satsPerUnit` value. Wraps `setConfigPath('server.accounts.satsPerUnit', sats)`. */
	onPersist: (newSats: number) => Promise<void>
}

export interface PriceUpdateTask {
	monitor: unknown
	storage: unknown
	name: 'PriceUpdate'
	lastRunMsecsSinceEpoch: number
	asyncSetup(): Promise<void>
	trigger(now: number): { run: boolean }
	runTask(): Promise<string>
}

export function buildPriceUpdateTask(
	options: PriceUpdateTaskOptions,
): PriceUpdateTask {
	const {
		monitor,
		rateProvider,
		intervalMs,
		targetUsd,
		bounds,
		readCurrentSats,
		onPersist,
	} = options

	const storage = (monitor as { storage?: unknown } | null | undefined)?.storage

	return {
		monitor,
		storage,
		name: 'PriceUpdate',
		lastRunMsecsSinceEpoch: 0,
		async asyncSetup() {},
		trigger(now: number): { run: boolean } {
			if (!(targetUsd > 0)) return { run: false }
			if (now - this.lastRunMsecsSinceEpoch < intervalMs) return { run: false }
			return { run: true }
		},
		async runTask(): Promise<string> {
			let quote: Awaited<ReturnType<RateProvider['getBsvUsd']>>
			try {
				quote = await rateProvider.getBsvUsd()
			} catch (err) {
				return `rate fetch failed: ${(err as Error).message}`
			}

			const currentSats = readCurrentSats()
			const result = computeReprice({
				targetUsd,
				bsvUsd: quote.bsvUsd,
				currentSats,
				bounds,
			})

			if (result.status === 'skipped') return `skipped: ${result.reason}`

			try {
				await onPersist(result.newSats)
			} catch (err) {
				return `persist failed: ${(err as Error).message}`
			}
			return `${currentSats} → ${result.newSats} sats/unit @ $${quote.bsvUsd}/BSV`
		},
	}
}
