import {
	type SigmaCWIConfig,
	type WebCWIConfig,
	createSigmaCWI,
	createWebCWI,
} from '@1sat/wallet'
import { WalletClient } from '@bsv/sdk'
import type { WalletInterface } from '@bsv/sdk'
import { SIGMA_URL, initiateSigmaOAuth, setSigmaIdentity } from './sigma-oauth'

export interface WalletProviderConfig {
	/** Provider identifier — 'onesat', 'sigma', or a custom string */
	type: string
	/** Display name for UI */
	name: string
	/** Icon URL or data URI */
	icon?: string
	/** Base URL for iframe-based providers */
	url?: string
}

export interface SigmaProviderConfig extends WalletProviderConfig {
	type: 'sigma'
	/** OAuth client ID registered with Sigma */
	clientId: string
	/** Local callback URL path (default: /auth/sigma/callback) */
	callbackURL?: string
}

export interface ConnectWalletConfig {
	/** Try WalletClient('auto') first (default: true) */
	autoDetect?: boolean
	/** Available providers for manual selection or fallback */
	providers?: WalletProviderConfig[]
}

export interface ConnectWalletResult {
	wallet: WalletInterface
	/** Which provider connected ('brc100', 'onesat', 'sigma', or custom) */
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

const DEFAULT_ONESAT_URL = 'https://1sat.market'

/**
 * Reconnect to a Sigma wallet after OAuth has completed.
 *
 * Creates the CWI iframe, sends SET_IDENTITY with the stored bapId,
 * and waits for authentication. Use this on page load when a stored
 * sigma connection exists.
 */
export async function reconnectSigma(
	config: SigmaProviderConfig,
	bapId: string,
): Promise<ConnectWalletResult> {
	const sigmaUrl = config.url ?? SIGMA_URL
	const cwiConfig: SigmaCWIConfig = { sigmaUrl }
	const { wallet, destroy, sendCustomMessage } = createSigmaCWI(cwiConfig)

	setSigmaIdentity(bapId)
	sendCustomMessage('SET_IDENTITY', { bapId })

	await wallet.waitForAuthentication({})
	const { publicKey } = await wallet.getPublicKey({ identityKey: true })

	return {
		wallet,
		provider: 'sigma',
		identityKey: publicKey,
		disconnect: destroy,
	}
}

async function connectBrc100AutoDetect(): Promise<ConnectWalletResult> {
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

function createProviderConnector(
	config: WalletProviderConfig,
): () => Promise<ConnectWalletResult> {
	switch (config.type) {
		case 'onesat':
			return async () => {
				const webConfig: WebCWIConfig = {}
				if (config.url) webConfig.walletUrl = config.url
				const { wallet, destroy } = createWebCWI(webConfig)
				await wallet.waitForAuthentication({})
				const { publicKey } = await wallet.getPublicKey({
					identityKey: true,
				})
				return {
					wallet,
					provider: 'onesat',
					identityKey: publicKey,
					disconnect: destroy,
				}
			}
		case 'sigma':
			return async () => {
				const sigmaConfig = config as SigmaProviderConfig
				if (!sigmaConfig.clientId) {
					throw new Error('Sigma provider requires clientId in config')
				}
				// Initiate OAuth redirect — this navigates the browser away
				// and returns a never-resolving promise
				return initiateSigmaOAuth({
					clientId: sigmaConfig.clientId,
					callbackURL: sigmaConfig.callbackURL,
				})
			}
		default:
			return () =>
				Promise.reject(
					new Error(`No built-in connector for provider type: ${config.type}`),
				)
	}
}

/**
 * Get the list of available wallet providers with connect functions.
 *
 * Use this when you need to present a provider selection UI.
 * Each provider has a `connect()` function that returns a ConnectWalletResult.
 */
export function getAvailableProviders(
	config?: ConnectWalletConfig,
): AvailableProvider[] {
	const providerConfigs = config?.providers ?? [
		{ type: 'onesat', name: 'OneSat Wallet', url: DEFAULT_ONESAT_URL },
	]

	return providerConfigs.map((p) => ({
		...p,
		detected: false,
		connect: createProviderConnector(p),
	}))
}

/**
 * Connect to a BRC-100 wallet with configurable provider detection.
 *
 * Detection order:
 * 1. If autoDetect (default true): WalletClient("auto") — browser extensions,
 *    Cicada, localhost wallet, XDM
 * 2. Falls through configured providers in order
 *
 * Returns null if no wallet is available. Use getAvailableProviders()
 * to present a manual selection UI instead.
 */
export async function connectWallet(
	config?: ConnectWalletConfig,
): Promise<ConnectWalletResult | null> {
	const autoDetect = config?.autoDetect ?? true

	if (autoDetect) {
		try {
			return await connectBrc100AutoDetect()
		} catch {
			// No BRC-100 wallet found via auto-detection
		}
	}

	// Try configured providers in order
	const providers = config?.providers ?? [
		{ type: 'onesat', name: 'OneSat Wallet', url: DEFAULT_ONESAT_URL },
	]

	for (const provider of providers) {
		try {
			return await createProviderConnector(provider)()
		} catch {
			// This provider failed, try next
		}
	}

	return null
}
