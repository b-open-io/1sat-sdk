import { WalletClient } from '@bsv/sdk'
import type { WalletInterface } from '@bsv/sdk'
import { createWebCWI, type WebCWIConfig } from '@1sat/wallet'

export interface ConnectWalletOptions {
	/** Base URL for the OneSat web wallet iframe fallback */
	walletUrl?: string
	/** Handshake timeout for the web CWI iframe in ms (default: 5000) */
	handshakeTimeout?: number
}

export interface ConnectWalletResult {
	wallet: WalletInterface
	provider: 'brc100' | 'onesat'
	identityKey: string
	disconnect: () => void
}

/**
 * Connect to a BRC-100 wallet using automatic substrate detection with
 * OneSat web wallet as fallback.
 *
 * Detection order:
 * 1. WalletClient("auto") — browser extensions (window.CWI), Cicada,
 *    localhost wallet, XDM
 * 2. createWebCWI — iframe bridge to OneSat web wallet (1satwallet.com)
 *
 * Returns null if no wallet is available.
 */
export async function connectWallet(
	options?: ConnectWalletOptions,
): Promise<ConnectWalletResult | null> {
	// Try BRC-100 substrate auto-detection first
	try {
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
	} catch {
		// No BRC-100 wallet found via auto-detection, try OneSat fallback
	}

	// Fall back to OneSat web wallet via iframe
	try {
		const config: WebCWIConfig = {}
		if (options?.walletUrl) config.walletUrl = options.walletUrl
		if (options?.handshakeTimeout)
			config.handshakeTimeout = options.handshakeTimeout

		const { wallet, destroy } = createWebCWI(config)
		await wallet.waitForAuthentication({})
		const { publicKey } = await wallet.getPublicKey({ identityKey: true })
		return {
			wallet,
			provider: 'onesat',
			identityKey: publicKey,
			disconnect: destroy,
		}
	} catch {
		// OneSat web wallet also unavailable
	}

	return null
}
