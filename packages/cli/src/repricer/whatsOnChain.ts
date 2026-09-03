import type { BsvUsdQuote, RateProvider } from './types.js'

export interface WhatsOnChainOptions {
	chain: 'main' | 'test'
	/** Override base URL (testing). */
	baseUrl?: string
}

export function createWhatsOnChainProvider(
	options: WhatsOnChainOptions,
): RateProvider {
	const base = options.baseUrl ?? 'https://api.whatsonchain.com/v1/bsv'
	const url = `${base}/${options.chain}/exchangerate`

	return {
		name: 'whatsonchain',
		async getBsvUsd(): Promise<BsvUsdQuote> {
			const res = await fetch(url)
			if (!res.ok) {
				throw new Error(
					`whatsonchain: ${res.status} ${await res.text().catch(() => '')}`,
				)
			}
			const body = (await res.json()) as { rate?: number; time?: number }
			if (typeof body.rate !== 'number' || !(body.rate > 0)) {
				throw new Error('whatsonchain: missing or invalid "rate" in response')
			}
			return {
				bsvUsd: body.rate,
				timestamp:
					typeof body.time === 'number' ? body.time * 1000 : Date.now(),
				source: 'whatsonchain',
			}
		},
	}
}
