import { type WebCWIConfig, createWebCWI } from '@1sat/wallet'
import { WalletClient } from '@bsv/sdk'
import type { WalletInterface } from '@bsv/sdk'

/**
 * Configuration for a wallet provider.
 *
 * Providers are wallet-agnostic — any service that speaks CWI over iframe
 * postMessage works. Provide either a `url` (uses the standard CWI iframe
 * bridge) or a custom `connect` function for non-standard transports.
 */
export interface WalletProviderConfig {
	/** Unique identifier for this provider */
	type: string
	/** Display name for UI */
	name: string
	/** Icon URL or data URI */
	icon?: string
	/** CWI iframe bridge URL — any host that implements CWI over postMessage */
	url?: string
	/** Custom connect function — use when the standard iframe bridge doesn't apply */
	connect?: () => Promise<ConnectWalletResult>
}

export interface ConnectWalletConfig {
	/** Include WalletClient('auto') in the race (default: true).
	 *  Detects any BRC-100 wallet: browser extensions (window.CWI),
	 *  desktop wallets (localhost), XDM, React Native. */
	autoDetect?: boolean
	/** Wallet providers to race alongside auto-detect.
	 *  No defaults — the consumer configures which providers to offer. */
	providers?: WalletProviderConfig[]
}

export interface ConnectWalletResult {
	wallet: WalletInterface
	/** Which provider connected (e.g. 'brc100' for auto-detect, or the provider's `type`) */
	provider: string
	identityKey: string
	disconnect: () => void
}

export interface AvailableProvider extends WalletProviderConfig {
	/** True if the provider was detected (e.g. extension installed) */
	detected: boolean
	/** Connect to this provider */
	connect: () => Promise<ConnectWalletResult>
}

/** @deprecated Use ConnectWalletConfig instead */
export type ConnectWalletOptions = ConnectWalletConfig

const LAST_PROVIDER_KEY = 'cwi_last_provider'

function saveLastProvider(providerType: string): void {
	if (typeof window === 'undefined') return
	try {
		localStorage.setItem(LAST_PROVIDER_KEY, providerType)
	} catch {
		// localStorage unavailable
	}
}

function loadLastProvider(): string | null {
	if (typeof window === 'undefined') return null
	try {
		return localStorage.getItem(LAST_PROVIDER_KEY)
	} catch {
		return null
	}
}

/**
 * BRC-100 auto-detect via WalletClient('auto').
 * Finds any wallet that exposes a BRC-100 substrate: browser extensions
 * (window.CWI), desktop wallets (localhost HTTP), XDM, React Native.
 */
async function connectAutoDetect(): Promise<ConnectWalletResult> {
	const client = new WalletClient('auto')
	await client.connectToSubstrate()
	await client.waitForAuthentication({})
	const { publicKey } = await client.getPublicKey({ identityKey: true })
	return {
		wallet: client,
		provider: 'brc100',
		identityKey: publicKey,
		disconnect: () => {},
	}
}

/**
 * Create a connect function for a provider config.
 * If the config has a custom `connect`, use it.
 * If the config has a `url`, use the standard CWI iframe bridge.
 * Otherwise, reject.
 */
function buildConnector(
	config: WalletProviderConfig,
): () => Promise<ConnectWalletResult> {
	// Custom connect function takes priority
	if (config.connect) {
		return config.connect
	}

	// URL-based providers use the standard CWI iframe bridge
	if (config.url) {
		return async () => {
			const webConfig: WebCWIConfig = { walletUrl: config.url }
			const { wallet, destroy } = createWebCWI(webConfig)
			await wallet.waitForAuthentication({})
			const { publicKey } = await wallet.getPublicKey({
				identityKey: true,
			})
			return {
				wallet,
				provider: config.type,
				identityKey: publicKey,
				disconnect: destroy,
			}
		}
	}

	return () =>
		Promise.reject(
			new Error(
				`Provider "${config.type}" has no url or connect function`,
			),
		)
}

/**
 * Get the list of available wallet providers with connect functions.
 *
 * Use this to present a provider selection UI. Each provider has a
 * `connect()` function that returns a ConnectWalletResult.
 *
 * Returns an empty array if no providers are configured.
 */
export function getAvailableProviders(
	config?: ConnectWalletConfig,
): AvailableProvider[] {
	const providerConfigs = config?.providers ?? []

	return providerConfigs.map((p) => ({
		...p,
		detected: false,
		connect: buildConnector(p),
	}))
}

/**
 * Connect to a BRC-100 wallet by racing all options in parallel.
 *
 * Behavior:
 * - All configured providers AND BRC-100 auto-detect (if enabled) start
 *   simultaneously via Promise.any(). First to authenticate wins.
 * - The winning provider type is saved to localStorage. On subsequent
 *   calls, the last-used provider is included in the race automatically
 *   (giving it a natural advantage since its iframe/connection may be warm).
 * - No providers are hard-coded. The consumer configures which providers
 *   to offer via the `providers` array.
 *
 * Returns null if no wallet connects. Use getAvailableProviders() to
 * present a manual selection UI instead.
 */
export async function connectWallet(
	config?: ConnectWalletConfig,
): Promise<ConnectWalletResult | null> {
	const autoDetect = config?.autoDetect ?? true
	const providers = config?.providers ?? []
	const lastProviderType = loadLastProvider()

	// Build all connection attempts to race
	const attempts: Promise<ConnectWalletResult>[] = []

	// BRC-100 auto-detect (any extension, desktop wallet, XDM)
	if (autoDetect) {
		attempts.push(connectAutoDetect())
	}

	// All configured iframe/custom providers
	for (const provider of providers) {
		attempts.push(buildConnector(provider)())
	}

	if (attempts.length === 0) return null

	// If we have a last-used provider that isn't already in the list,
	// we don't add it — consumer controls what providers are available.
	// The advantage for returning users is that their provider's iframe
	// may already be cached/warm from the previous session.

	try {
		const result = await Promise.any(attempts)
		saveLastProvider(result.provider)
		return result
	} catch {
		// All attempts failed
		return null
	}
}
