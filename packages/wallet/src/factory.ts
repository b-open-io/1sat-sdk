import { OneSatServices } from '@1sat/client'
import { KeyDeriver, type PrivateKey, type WalletInterface } from '@bsv/sdk'
import type { sdk as toolboxSdk } from '@bsv/wallet-toolbox'
import { parsePrivateKey } from './parsePrivateKey'
import {
	installStorageClientPaymentAutoRetry,
	installStoragePaymentAutoRetry,
	type StoragePaymentHook,
} from './storagePaymentAutoRetry'

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
	/**
	 * Interval in ms between periodic `updateBackups()` runs when local
	 * storage is the active store. Defaults to 5 minutes. Set to 0 to
	 * disable (caller drives sync manually). Ignored when `activeRemote`
	 * is set — remote-active deployments treat the remote as canonical
	 * and don't push local-to-remote on a schedule.
	 */
	backupSyncIntervalMs?: number
	/**
	 * Optional consent hook for 507 Insufficient Storage auto-retry. Fires
	 * when an active-remote billable op returns 507; receives the remote's
	 * current pricing + next-payment derivation. Return true to fund and
	 * retry, false to propagate the error. Default when omitted is true
	 * (auto-fund). Full consent UX layers on top in a later pass.
	 *
	 * Only engages when an `activeRemote` is set — local-active wallets
	 * can't hit a 507.
	 */
	onStoragePaymentRequired?: StoragePaymentHook
}

export interface WalletCoreResult {
	wallet: InstanceType<any>
	services: OneSatServices
	storage: InstanceType<any>
	/**
	 * Present only when the caller supplies a `Monitor` class in the toolbox
	 * (wallet-node, wallet-browser). Remote-active wrappers (wallet-remote)
	 * omit the class; the server owns the monitor loop and the client's
	 * result has `monitor: undefined`.
	 */
	monitor: InstanceType<any> | undefined
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
	/**
	 * Returns the currently active storage provider. Live getter: reflects
	 * the result of any prior setActiveStorage call. Intended for callers
	 * (e.g. an RPC server) that need to expose the raw provider directly
	 * rather than go through the single-tenant WalletStorageManager.
	 */
	getActiveStorage: () => WalletStorageProvider
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
		/**
		 * Optional. When the caller supplies a Monitor class, the factory
		 * constructs an idle instance and wires the periodic BackupSync task.
		 * Wrappers that don't own a monitor loop (e.g. `wallet-remote` —
		 * the server runs its own monitor) should omit this.
		 */
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

	// Captured once here so the storage-client wrapper's payment builds
	// always call the unwrapped createAction even after the wallet-level
	// wrapper installs below.
	const unwrappedCreateAction = wallet.createAction.bind(wallet)

	const connectRemote = async (url: string) => {
		const client = new toolbox.StorageClient(
			wallet as unknown as WalletInterface,
			url,
		)
		installStorageClientPaymentAutoRetry({
			client,
			wallet: wallet as unknown as WalletInterface,
			createAction: unwrappedCreateAction,
			onStoragePaymentRequired: config.onStoragePaymentRequired,
		})
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

	// `intendedActiveKey` is the store the factory considers canonical for
	// this wallet. Set after the initial active store lands, updated by
	// `setActiveStorage` later. Used by `reconcileActive` to resolve the
	// conflict-active state that arises when a newly-added backup's user
	// row defaults `activeStorage` to its own key.
	let intendedActiveKey: string | undefined

	if (config.activeRemote) {
		// Remote-primary: connect remote first, set active, then add local as backup
		const activeClient = await connectRemote(config.activeRemote)
		const settings = activeClient.getSettings()
		if (settings?.storageIdentityKey) {
			intendedActiveKey = settings.storageIdentityKey
			await storage.setActive(intendedActiveKey)
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
		intendedActiveKey = (await localStorage.makeAvailable()).storageIdentityKey
	}

	/**
	 * Re-assert the intended active store when adding a provider has put the
	 * manager into a conflict-active state. A fresh user row on a newly-
	 * connected backup defaults `activeStorage` to that backup's own key,
	 * which `WalletStorageManager` treats as a conflict against our chosen
	 * active. `storage.setActive` resolves via wallet-toolbox's merge-and-
	 * flip dance — record-level data is additive (no loss), only pointers
	 * and reconcilable status fields change.
	 */
	const reconcileActive = async (): Promise<void> => {
		if (!intendedActiveKey) return
		if (storage.isActiveEnabled) return
		await storage.setActive(intendedActiveKey)
	}

	// Connect backup remotes
	if (config.backups) {
		for (const url of config.backups) {
			await connectRemote(url)
			await reconcileActive()
		}
	}

	// Install 507 auto-retry on billable methods. Only meaningful when an
	// active remote is (or may later become) in play; the hook bails early
	// when local is active.
	const getActiveRemoteUrl = (): string | undefined => {
		try {
			const active = storage.getActive() as {
				endpointUrl?: string
				isStorageProvider?: () => boolean
			}
			if (active?.isStorageProvider?.()) return undefined
			return active?.endpointUrl
		} catch {
			return undefined
		}
	}
	installStoragePaymentAutoRetry({
		wallet: wallet as unknown as WalletInterface,
		getActiveRemoteUrl,
		onStoragePaymentRequired: config.onStoragePaymentRequired,
	})

	// Monitor only exists when the caller supplied a Monitor class in the
	// toolbox. wallet-node and wallet-browser do; wallet-remote doesn't
	// (server owns the monitor loop). When present, the task loop is still
	// caller-driven via startTasks / runOnce — factory just constructs and
	// wires defaults.
	//
	// Suppressed when a remote is active: the remote server owns the monitor
	// for its own storage. Running a local monitor against a StorageClient
	// would attempt StorageProvider operations on a non-StorageProvider and
	// fail with WERR_INVALID_OPERATION on every tick.
	let monitor: InstanceType<any> | undefined
	if (toolbox.Monitor && !config.activeRemote) {
		monitor = new toolbox.Monitor({
			chain: config.chain,
			services: oneSatServices as any,
			storage,
			chaintracks: oneSatServices.chaintracks,
			msecsWaitPerMerkleProofServiceReq: 500,
			taskRunWaitMsecs: 5000,
			abandonedMsecs: 300000,
			unprovenAttemptsLimitTest: 10,
			unprovenAttemptsLimitMain: 144,
		})
		monitor.addDefaultTasks()

		// Periodic backup sync task. Fires only when local is the active store;
		// with a remote active, pushing local-to-remote on a schedule would be
		// unnecessary (remote is canonical) and the auto-retry payment path can
		// deadlock against the manager's locks if it fires inside a scheduled
		// backup task. Interval defaults to 5 min.
		const backupSyncIntervalMs = config.backupSyncIntervalMs ?? 5 * 60 * 1000
		if (backupSyncIntervalMs > 0) {
			monitor.addTask(
				buildBackupSyncTask(monitor, backupSyncIntervalMs, storage),
			)
		}

		if (config.onTransactionBroadcasted) {
			monitor.onTransactionBroadcasted = async (result: any) => {
				if (result.txid) config.onTransactionBroadcasted!(result.txid)
			}
		}
		if (config.onTransactionProven) {
			monitor.onTransactionProven = async (status: any) => {
				config.onTransactionProven!(status.txid, status.blockHeight)
			}
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
			intendedActiveKey = localKey
			return
		}

		const existing = remoteClients.find((c) => c.endpointUrl === target)
		if (existing) {
			const settings = existing.getSettings()
			if (settings?.storageIdentityKey) {
				await storage.setActive(settings.storageIdentityKey)
				intendedActiveKey = settings.storageIdentityKey
			}
			return
		}

		const client = await connectRemote(target)
		const settings = client.getSettings()
		if (settings?.storageIdentityKey) {
			await storage.setActive(settings.storageIdentityKey)
			intendedActiveKey = settings.storageIdentityKey
		}
	}

	const addRemote = async (url: string): Promise<void> => {
		const existing = remoteClients.find((c) => c.endpointUrl === url)
		if (existing) return
		await connectRemote(url)
		await reconcileActive()
	}

	// 7. Destroy
	const destroy = async (): Promise<void> => {
		if (monitor) {
			try {
				monitor.stopTasks()
				if (monitor._tasksRunningPromise) {
					await monitor._tasksRunningPromise
				}
				await monitor.destroy()
			} catch {}
		}
		await wallet.destroy()
	}

	return {
		wallet,
		services: oneSatServices,
		storage,
		monitor,
		destroy,
		remoteClients,
		setActiveStorage,
		addRemote,
		getActiveStorage: () => storage.getActive(),
		feeModel,
	}
}

/**
 * Builds a plain-object Monitor task that calls `storage.updateBackups()`
 * periodically. Shape-compatible with `WalletMonitorTask` — no class
 * extension needed, so the factory doesn't need to import the abstract
 * class from whichever wallet-toolbox variant the caller uses.
 *
 * Only fires when local is the active store — with a remote active,
 * pushing local-to-remote on a schedule is unnecessary (remote is
 * canonical) and in a metered-remote setup it can trigger the auto-retry
 * payment path to deadlock against the manager's locks.
 */
function buildBackupSyncTask(
	monitor: any,
	triggerMsecs: number,
	storage: any,
): any {
	return {
		monitor,
		storage: monitor.storage,
		name: 'BackupSync',
		lastRunMsecsSinceEpoch: 0,
		async asyncSetup() {},
		trigger(nowMsecsSinceEpoch: number): { run: boolean } {
			if (nowMsecsSinceEpoch - this.lastRunMsecsSinceEpoch < triggerMsecs) {
				return { run: false }
			}
			if (storage.getBackupStores().length === 0) return { run: false }
			try {
				const active = storage.getActive() as any
				if (!active?.isStorageProvider?.()) return { run: false }
			} catch {
				return { run: false }
			}
			return { run: true }
		},
		async runTask(): Promise<string> {
			try {
				await storage.updateBackups()
				return 'backup sync complete'
			} catch (err) {
				return `backup sync failed: ${(err as Error).message}`
			}
		},
	}
}
