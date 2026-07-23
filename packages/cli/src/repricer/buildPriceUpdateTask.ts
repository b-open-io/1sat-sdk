import { computeReprice } from './computeReprice'
import type { RateProvider, RepricerBounds } from './types'

/** One price the repricer maintains from the shared BSV/USD quote. */
export interface RepriceTarget {
	/** Label for task result logs, e.g. 'accounts' or 'hosting'. */
	name: string
	/** USD target for this price. Targets with 0 or negative are ignored. */
	targetUsd: number
	/** Read the current sats value (typically from disk via the same loader the servers use). */
	readCurrentSats: () => number
	/** Persist the new sats value (wraps `setConfigPath`). */
	onPersist: (newSats: number) => Promise<void>
}

export interface PriceUpdateTaskOptions {
	monitor: unknown
	rateProvider: RateProvider
	/** Interval between successful tick attempts. */
	intervalMs: number
	bounds: RepricerBounds
	targets: RepriceTarget[]
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
	const { monitor, rateProvider, intervalMs, bounds } = options
	const targets = options.targets.filter((t) => t.targetUsd > 0)

	const storage = (monitor as { storage?: unknown } | null | undefined)?.storage

	return {
		monitor,
		storage,
		name: 'PriceUpdate',
		lastRunMsecsSinceEpoch: 0,
		async asyncSetup() {},
		trigger(now: number): { run: boolean } {
			if (targets.length === 0) return { run: false }
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

			const parts: string[] = []
			for (const target of targets) {
				const currentSats = target.readCurrentSats()
				const result = computeReprice({
					targetUsd: target.targetUsd,
					bsvUsd: quote.bsvUsd,
					currentSats,
					bounds,
				})

				if (result.status === 'skipped') {
					parts.push(`${target.name}: skipped: ${result.reason}`)
					continue
				}

				try {
					await target.onPersist(result.newSats)
				} catch (err) {
					parts.push(
						`${target.name}: persist failed: ${(err as Error).message}`,
					)
					continue
				}
				parts.push(`${target.name}: ${currentSats} → ${result.newSats} sats`)
			}
			return `${parts.join('; ')} @ $${quote.bsvUsd}/BSV`
		},
	}
}
