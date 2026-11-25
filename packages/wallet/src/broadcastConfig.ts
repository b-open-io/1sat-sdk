/**
 * Broadcast settings for the wallet's failover broadcasters.
 *
 * 1sat-stack is always tried first. When it gives no verdict on a
 * transaction (down, timed out, unknown status), `OneSatServices.postBeef`
 * hands the transaction to wallet-toolbox `Services`, which tries its
 * broadcasters in order until one accepts it: Arcade (only when
 * `arcadeUrl` is set), GorillaPool ARC, TAAL ARC, Bitails, then
 * WhatsOnChain. Bitails and WhatsOnChain are always included on main and
 * test. Field names follow wallet-toolbox `WalletServicesOptions`.
 */
export interface BroadcastConfig {
	/** Fail over to the toolbox broadcasters when 1sat-stack gives no verdict. Default true. */
	failover?: boolean
	/** Arcade endpoint, tried first when set. */
	arcadeUrl?: string
	arcadeApiKey?: string
	/** GorillaPool ARC endpoint. An empty string removes it. */
	arcGorillaPoolUrl?: string
	arcGorillaPoolApiKey?: string
	/** TAAL ARC endpoint. An empty string removes it. */
	arcUrl?: string
	arcApiKey?: string
	bitailsApiKey?: string
	whatsOnChainApiKey?: string
}

/** Config keys that hold secrets, so callers can mask them when printing. */
export const BROADCAST_SECRET_KEYS = [
	'arcadeApiKey',
	'arcGorillaPoolApiKey',
	'arcApiKey',
	'bitailsApiKey',
	'whatsOnChainApiKey',
] as const

// biome-ignore lint/suspicious/noExplicitAny: toolbox WalletServicesOptions comes from whichever toolbox build the runtime loads
type ServicesOptions = Record<string, any>

/**
 * Applies `config` on top of the toolbox defaults from
 * `Services.createDefaultOptions(chain)`. Returns a new object; `defaults`
 * is not changed. Unset fields keep the toolbox default.
 */
export function applyBroadcastConfig(
	defaults: ServicesOptions,
	config: BroadcastConfig | undefined,
): ServicesOptions {
	const o: ServicesOptions = { ...defaults }
	if (!config) return o

	if (config.arcUrl !== undefined) o.arcUrl = config.arcUrl
	if (config.arcApiKey !== undefined)
		o.arcConfig = { ...o.arcConfig, apiKey: config.arcApiKey || undefined }

	if (config.arcGorillaPoolUrl !== undefined)
		o.arcGorillaPoolUrl = config.arcGorillaPoolUrl
	if (config.arcGorillaPoolApiKey !== undefined)
		o.arcGorillaPoolConfig = {
			...(o.arcGorillaPoolConfig ?? o.arcConfig),
			apiKey: config.arcGorillaPoolApiKey || undefined,
		}

	if (config.arcadeUrl !== undefined) {
		o.arcadeUrl = config.arcadeUrl || undefined
		if (o.arcadeUrl && !o.arcadeConfig) {
			// Same deployment id as the ARC providers, like the toolbox default.
			o.arcadeConfig = { deploymentId: o.arcConfig?.deploymentId }
		}
		if (!o.arcadeUrl) o.arcadeConfig = undefined
	}
	if (config.arcadeApiKey !== undefined && o.arcadeUrl)
		o.arcadeConfig = {
			...o.arcadeConfig,
			apiKey: config.arcadeApiKey || undefined,
		}

	if (config.bitailsApiKey !== undefined)
		o.bitailsApiKey = config.bitailsApiKey || undefined
	if (config.whatsOnChainApiKey !== undefined)
		o.whatsOnChainApiKey = config.whatsOnChainApiKey || undefined

	return o
}
