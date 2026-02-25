import { OneSatServices } from '@1sat/client'
import { KeyDeriver, PrivateKey, type WalletInterface } from '@bsv/sdk'
import type { sdk as mobileSdk } from '@bsv/wallet-toolbox'
import {
	Services,
	StorageClient,
	Wallet,
	WalletStorageManager,
} from '@bsv/wallet-toolbox/out/src/index.client.js'

type Chain = 'main' | 'test'
type MobileWalletServices = mobileSdk.WalletServices

const DEFAULT_FEE_MODEL = { model: 'sat/kb' as const, value: 100 }
const DEFAULT_CONNECTION_TIMEOUT = 5000

export interface RemoteWalletConfig {
	/** Private key - can be PrivateKey instance, WIF string, or hex string */
	privateKey: PrivateKey | string
	/** Network: 'main' or 'test' */
	chain: Chain
	/** Remote storage server URL */
	remoteStorageUrl: string
	/** Fee model. Default: { model: 'sat/kb', value: 100 } */
	feeModel?: { model: 'sat/kb'; value: number }
	/** Connection timeout in milliseconds. Default: 5000 */
	connectionTimeout?: number
}

export interface RemoteWalletResult {
	/** Wallet instance */
	wallet: Wallet
	/** 1Sat services for API access */
	services: OneSatServices
	/** Cleanup function - destroys wallet */
	destroy: () => Promise<void>
	/** Storage manager (for diagnostics) */
	storage: WalletStorageManager
	/** Effective fee model used by this wallet */
	feeModel: { model: 'sat/kb'; value: number }
}

function parsePrivateKey(input: PrivateKey | string): PrivateKey {
	if (input instanceof PrivateKey) {
		return input
	}

	if (/^[5KLc][1-9A-HJ-NP-Za-km-z]{50,51}$/.test(input)) {
		return PrivateKey.fromWif(input)
	}

	if (/^[0-9a-fA-F]{64}$/.test(input)) {
		return new PrivateKey(input)
	}

	try {
		return PrivateKey.fromWif(input)
	} catch {
		throw new Error(
			'Invalid private key format. Expected PrivateKey instance, WIF string, or 64-char hex string.',
		)
	}
}

/**
 * Create a wallet that uses a remote storage server as its sole storage.
 *
 * No local storage (IndexedDB/SQLite) is created. No Monitor is started
 * client-side — the server handles transaction lifecycle (broadcasting,
 * proof checking, failure management).
 */
export async function createRemoteWallet(
	config: RemoteWalletConfig,
): Promise<RemoteWalletResult> {
	const { chain } = config
	const feeModel = config.feeModel ?? DEFAULT_FEE_MODEL
	const timeout = config.connectionTimeout ?? DEFAULT_CONNECTION_TIMEOUT

	const privateKey = parsePrivateKey(config.privateKey)
	const identityPubKey = privateKey.toPublicKey().toString()
	const keyDeriver = new KeyDeriver(privateKey)

	const fallbackServices = new Services(chain)
	const oneSatServices = new OneSatServices(chain, undefined, fallbackServices)

	// Create storage manager without any stores initially.
	// _authId is set from identityKey, which is all the Wallet constructor needs.
	const storage = new WalletStorageManager(identityPubKey)

	// Create wallet — needed by StorageClient for AuthFetch signing.
	// The Wallet constructor only checks storage._authId.identityKey and calls
	// storage.setServices(), both of which work on an empty manager.
	const wallet = new Wallet({
		chain,
		keyDeriver,
		storage,
		services: oneSatServices as MobileWalletServices,
	})

	// Create remote storage client using the wallet for authenticated requests.
	const remoteClient = new StorageClient(
		wallet as unknown as WalletInterface,
		config.remoteStorageUrl,
	)

	// Connect and make the remote storage the active (and only) store.
	// addWalletStorageProvider calls remoteClient.makeAvailable() internally,
	// which triggers AuthFetch using the wallet for signing.
	const timeoutPromise = new Promise<never>((_, reject) =>
		setTimeout(
			() => reject(new Error('Remote storage connection timeout')),
			timeout,
		),
	)
	await Promise.race([
		storage.addWalletStorageProvider(remoteClient),
		timeoutPromise,
	])

	// Ensure user.activeStorage matches the remote server's storageIdentityKey.
	// Without this, isActiveEnabled returns false and writes fail with WERR_NOT_ACTIVE.
	const remoteSettings = remoteClient.getSettings()
	if (remoteSettings?.storageIdentityKey) {
		await storage.setActive(remoteSettings.storageIdentityKey)
	}

	const destroy = async (): Promise<void> => {
		await wallet.destroy()
	}

	return {
		wallet,
		services: oneSatServices,
		destroy,
		storage,
		feeModel,
	}
}
