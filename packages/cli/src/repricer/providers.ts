import type { RateProvider } from './types.js'
import { createWhatsOnChainProvider } from './whatsOnChain.js'

export interface ResolveProviderOptions {
	chain: 'main' | 'test'
}

export function resolveRateProvider(
	name: string,
	options: ResolveProviderOptions,
): RateProvider {
	switch (name) {
		case 'whatsonchain':
			return createWhatsOnChainProvider({ chain: options.chain })
		default:
			throw new Error(
				`Unknown rate provider "${name}". Supported: whatsonchain.`,
			)
	}
}
