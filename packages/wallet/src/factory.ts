import { OneSatServices } from '@1sat/client'
import { KeyDeriver, type PrivateKey, type WalletInterface } from '@bsv/sdk'
import type { sdk as toolboxSdk } from '@bsv/wallet-toolbox'
import { parsePrivateKey } from './parsePrivateKey'

type WalletServices = toolboxSdk.WalletServices
type WalletStorageProvider = toolboxSdk.WalletStorageProvider

export type Chain = 'main' | 'test'

export const DEFAULT_FEE_MODEL = { model: 'sat/kb' as const, value: 100 }
export const DEFAULT_CONNECTION_TIMEOUT = 5000

export interface WalletCoreConfig {
	privateKey: PrivateKey | string
	chain: Chain
	feeModel?: { model: 'sat/kb'; value: number }
	activeRemote?: string
	backups?: string[]
	connectionTimeout?: number
	onTransactionBroadcasted?: (txid: string) => void
	onTransactionProven?: (txid: string, blockHeight: number) => void
}

export interface WalletCoreResult {
	wallet: InstanceType<any>
	services: OneSatServices
	storage: InstanceType<any>
	destroy: () => Promise<void>
	remoteClients: InstanceType<any>[]
	/**
	 * Switch the active storage. Pass 'local' to promote the local storage
	 * provider to active (throws if no local storage was configured), or a
	 * URL to promote an already-configured remote (or connect it first if
	 * not yet known). Data is migrated from the current active into every
	 * other store by WalletStorageManager.setActive before the pointer flips.
	 */
	setActiveStorage: (target: 'local' | string) => Promise<void>
	/**
	 * Connect a remote URL as a non-active backup. Does not change the
	 * active store. No-op if the URL is already registered.
	 */
	addRemote: (url: string) => Promise<void>
	feeModel: { model: 'sat/kb'; value: number }
}

export async function createWalletCore(
	config: WalletCoreConfig,
	localStorage: WalletStorageProvider | undefined,
	toolbox: {
		Services: any
		StorageClient: any
		StorageProvider: any
		Wallet: any
		WalletStorageManager: any
		Monitor?: any
	},
): Promise<WalletCoreResult> {
	const { chain } = config
	const feeModel = config.feeModel ?? DEFAULT_FEE_MODEL
	const timeout = config.connectionTimeout ?? DEFAULT_CONNECTION_TIMEOUT

	const privateKey = parsePrivateKey(config.privateKey)
	const identityPubKey = privateKey.toPublicKey().toString()
	const keyDeriver = new KeyDeriver(privateKey)

	// 1. Create services
	const fallbackServices = new toolbox.Services(chain)
	const oneSatServices = new OneSatServices(chain, undefined, fallbackServices)

	// 2. Create storage manager — empty initially
	const storage = new toolbox.WalletStorageManager(identityPubKey)

	// 3. Create wallet (needed for StorageClient auth)
	const wallet = new toolbox.Wallet({
		chain,
		keyDeriver,
		storage,
		services: oneSatServices as unknown as WalletServices,
	})

	// 4. Connect remotes
	const remoteClients: InstanceType<typeof toolbox.StorageClient>[] = []

	const connectRemote = async (url: string) => {
		const client = new toolbox.StorageClient(
			wallet as unknown as WalletInterface,
			url,
		)
		const timeoutPromise = new Promise<never>((_, reject) =>
			setTimeout(
				() => reject(new Error(`Remote storage connection timeout: ${url}`)),
				timeout,
			),
		)
		await Promise.race([
			storage.addWalletStorageProvider(client),
			timeoutPromise,
		])
		remoteClients.push(client)
		return client
	}

	if (config.activeRemote) {
		// Remote-primary: connect remote first, set active, then add local as backup
		const activeClient = await connectRemote(config.activeRemote)
		const settings = activeClient.getSettings()
		if (settings?.storageIdentityKey) {
			await storage.setActive(settings.storageIdentityKey)
		}
		if (localStorage) {
			await localStorage.makeAvailable()
			const { user } = await localStorage.findOrInsertUser(identityPubKey)
			await (localStorage as any).setActive(
				{ identityKey: identityPubKey, userId: user.userId },
				settings.storageIdentityKey,
			)
			await storage.addWalletStorageProvider(localStorage)
		}
	} else if (localStorage) {
		// Local-primary: no remote, local is the active store
		await storage.addWalletStorageProvider(localStorage)
	}

	// Connect backup remotes
	if (config.backups) {
		for (const url of config.backups) {
			await connectRemote(url)
		}
	}

	// 5. Wire updateBackups interception (with guard to prevent double-wrapping)
	let backupInterceptionWired = false

	const wireBackupInterception = () => {
		if (backupInterceptionWired) return
		if (storage.getBackupStores().length === 0) return
		backupInterceptionWired = true

		const originalCreateAction = wallet.createAction.bind(wallet)
		wallet.createAction = async (args: any) => {
			const result = await originalCreateAction(args)
			if (result.txid) {
				storage.updateBackups().catch((err: unknown) => {
					console.error('[wallet-core] post-action backup failed:', err)
				})
			}
			return result
		}

		const originalSignAction = wallet.signAction.bind(wallet)
		wallet.signAction = async (args: any) => {
			const result = await originalSignAction(args)
			if (result.txid) {
				storage.updateBackups().catch((err: unknown) => {
					console.error('[wallet-core] post-action backup failed:', err)
				})
			}
			return result
		}
	}

	wireBackupInterception()

	// Initial backup sync: push current active state into every backup store
	// so fresh or wiped backups are populated before the wallet is used.
	// Never fail wallet creation on backup failure — the active store is
	// already usable; the caller can retry sync via updateBackups() later.
	if (storage.getBackupStores().length > 0) {
		try {
			await storage.updateBackups()
		} catch (err) {
			console.error('[wallet-core] initial backup sync failed:', err)
		}
	}

	// 6. Remote management operations
	const setActiveStorage = async (target: 'local' | string): Promise<void> => {
		if (target === 'local') {
			if (!localStorage) {
				throw new Error(
					'setActiveStorage("local") called on a wallet with no local storage',
				)
			}
			const localKey = (await localStorage.makeAvailable()).storageIdentityKey
			await storage.setActive(localKey)
			return
		}

		const existing = remoteClients.find((c) => c.endpointUrl === target)
		if (existing) {
			const settings = existing.getSettings()
			if (settings?.storageIdentityKey) {
				await storage.setActive(settings.storageIdentityKey)
			}
			return
		}

		const client = await connectRemote(target)
		const settings = client.getSettings()
		if (settings?.storageIdentityKey) {
			await storage.setActive(settings.storageIdentityKey)
		}

		wireBackupInterception()
	}

	const addRemote = async (url: string): Promise<void> => {
		const existing = remoteClients.find((c) => c.endpointUrl === url)
		if (existing) return
		await connectRemote(url)
		wireBackupInterception()
	}

	// 7. Destroy
	const destroy = async (): Promise<void> => {
		await wallet.destroy()
	}

	return {
		wallet,
		services: oneSatServices,
		storage,
		destroy,
		remoteClients,
		setActiveStorage,
		addRemote,
		feeModel,
	}
}
