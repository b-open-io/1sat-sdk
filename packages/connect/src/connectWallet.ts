import { type WebCWIConfig, createWebCWI } from '@1sat/wallet'
import { WalletClient } from '@bsv/sdk'
import type { WalletInterface } from '@bsv/sdk'

/**
 * Configuration for a wallet provider.
 *
 * Two ways to configure:
 * - `url` — CWI iframe bridge to any host that implements CWI over postMessage
 * - `connect` — custom connect function for any transport
 *
 * If both are provided, `connect` takes priority.
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
	/** Custom connect function — overrides url-based iframe bridge */
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
	/** Which provider connected (e.g. 'brc100' for auto-detect, or the provider's type) */
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

export function loadLastProvider(): string | null {
	if (typeof window === 'undefined') return null
	try {
		return localStorage.getItem(LAST_PROVIDER_KEY)
	} catch {
		return null
	}
}

/**
 * BRC-100 auto-detect via WalletClient('auto').
 * Finds any wallet exposing a BRC-100 substrate: browser extensions
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
 * Build a connect function for a provider config.
 * Custom connect > url (CWI iframe bridge) > reject.
 */
function buildConnector(
	config: WalletProviderConfig,
): () => Promise<ConnectWalletResult> {
	if (config.connect) {
		return config.connect
	}

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
 * Auto-detect and all configured providers start simultaneously via
 * Promise.any(). First to authenticate wins. The winning provider
 * type is saved to localStorage for warm reconnects.
 *
 * Returns null if no wallet connects.
 */
export async function connectWallet(
	config?: ConnectWalletConfig,
): Promise<ConnectWalletResult | null> {
	const autoDetect = config?.autoDetect ?? true
	const providers = config?.providers ?? []

	const attempts: Promise<ConnectWalletResult>[] = []

	if (autoDetect) {
		attempts.push(connectAutoDetect())
	}

	for (const provider of providers) {
		attempts.push(buildConnector(provider)())
	}

	if (attempts.length === 0) return null

	try {
		const result = await Promise.any(attempts)
		saveLastProvider(result.provider)
		return result
	} catch {
		return null
	}
}
