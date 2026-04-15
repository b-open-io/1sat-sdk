import { type WebCWIConfig, createWebCWI } from '@1sat/wallet'
import { WalletClient } from '@bsv/sdk'
import type { WalletInterface } from '@bsv/sdk'

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
	/** Wallet providers to race alongside auto-detect. */
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
	connect: () => Promise<ConnectWalletResult>
}

/** @deprecated Use ConnectWalletConfig instead */
export type ConnectWalletOptions = ConnectWalletConfig

const LAST_PROVIDER_KEY = 'cwi_last_provider'

function saveLastProvider(providerType: string): void {
	if (typeof window === 'undefined') return
	try {
		localStorage.setItem(LAST_PROVIDER_KEY, providerType)
	} catch {}
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
 * Finds any wallet exposing a BRC-100 substrate: browser extensions,
 * desktop wallets, XDM, React Native.
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
 * Custom connect > url (CWI iframe bridge) > error.
 */
function buildConnector(
	config: WalletProviderConfig,
): () => Promise<ConnectWalletResult> {
	if (config.connect) return config.connect

	if (config.url) {
		return async () => {
			const webConfig: WebCWIConfig = { walletUrl: config.url }
			const { wallet, destroy } = createWebCWI(webConfig)
			await wallet.waitForAuthentication({})
			const { publicKey } = await wallet.getPublicKey({ identityKey: true })
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
			new Error(`Provider "${config.type}" has no url or connect function`),
		)
}

/**
 * Get available wallet providers with connect functions.
 * Sorts by last successful provider for faster reconnects.
 */
export function getAvailableProviders(
	config?: ConnectWalletConfig,
): AvailableProvider[] {
	const providerConfigs = config?.providers ?? []
	const lastProvider = loadLastProvider()

	return providerConfigs
		.map((p) => ({ ...p, connect: buildConnector(p) }))
		.sort((a, b) => {
			if (a.type === lastProvider) return -1
			if (b.type === lastProvider) return 1
			return 0
		})
}

/**
 * Connect to a BRC-100 wallet by racing all options in parallel.
 *
 * Auto-detect and all configured providers start simultaneously via
 * Promise.any(). First to authenticate wins. The winning provider
 * type is saved to localStorage for warm reconnects.
 *
 * If the last successful provider is known, it's attempted first
 * before falling back to the full race.
 */
export async function connectWallet(
	config?: ConnectWalletConfig,
): Promise<ConnectWalletResult> {
	const autoDetect = config?.autoDetect ?? true
	const providers = config?.providers ?? []

	// Warm reconnect: try the last successful provider first
	const lastType = loadLastProvider()
	if (lastType) {
		const lastConfig = providers.find((p) => p.type === lastType)
		if (lastConfig) {
			try {
				const result = await buildConnector(lastConfig)()
				saveLastProvider(result.provider)
				return result
			} catch {
				// Last provider failed — fall through to full race
			}
		}
	}

	const attempts: Promise<ConnectWalletResult>[] = []

	if (autoDetect) {
		attempts.push(connectAutoDetect())
	}

	for (const provider of providers) {
		attempts.push(buildConnector(provider)())
	}

	if (attempts.length === 0) {
		throw new Error('No wallet providers configured and autoDetect is disabled')
	}

	const result = await Promise.any(attempts)
	saveLastProvider(result.provider)
	return result
}
