import { OneSatServices } from '@1sat/client'
import { KeyDeriver, type PrivateKey, type WalletInterface } from '@bsv/sdk'
import { parsePrivateKey } from './parsePrivateKey'
import {
	installStorageClientPaymentAutoRetry,
	installStoragePaymentAutoRetry,
	type StoragePaymentHook,
} from './storagePaymentAutoRetry'

/**
 * Minimal structural view of a `WalletStorageProvider`. Kept structural so
 * the factory stays runtime-neutral: `@1sat/wallet-node` supplies a
 * `StorageKnex` from `@bsv/wallet-toolbox` while `@1sat/wallet-browser`
 * supplies a `StorageIdb` from `@bsv/wallet-toolbox-client`, and a nominal
 * type from either package would reject the other.
 */
export interface WalletStorageProviderLike {
	makeAvailable(): Promise<{ storageIdentityKey: string }>
}

export type Chain = 'main' | 'test'

export const DEFAULT_FEE_MODEL = { model: 'sat/kb' as const, value: 100 }
export const DEFAULT_CONNECTION_TIMEOUT = 5000

/**
 * Persists Monitor task state across processes so that transient consumers
 * (CLI invocations, service worker wakes) can inherit triggers and queued
 * chain-tip state that would otherwise be lost on every fresh Monitor.
 *
 * Bulk semantics: load returns the entire taskName -> state map; save
 * replaces it. Per-task value shape is interpreted in this factory:
 * - Most tasks store a `number` (`lastRunMsecsSinceEpoch`).
 * - `TaskNewHeader` stores `{ header, queuedHeader, queuedHeaderWhen }` so
 *   the "wait one cycle before fetching proofs" handshake survives a process
 *   restart — without this, CLI invocations always look like first-run and
 *   `TaskCheckForProofs` never gets armed.
 *
 * Backward compat: if the persisted value for a task is a raw `number`, it
 * is treated as legacy `lastRunMsecsSinceEpoch` (matches the old shape).
 *
 * Implementations live in runtime-specific packages (`@1sat/wallet-node` for
 * filesystem, `@1sat/wallet-browser` for IndexedDB).
 */
export interface TaskStateStore {
	load(): Promise<Record<string, unknown>>
	save(state: Record<string, unknown>): Promise<void>
}

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
	 * Interval in ms for the BackupSync monitor task (active → backups).
	 * Defaults to 5 minutes. Set to 0 to omit the task (manual
	 * `storage.updateBackups()` only). Applies for local-active and
	 * remote-active; callers still drive work via `monitor.runOnce()`.
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
	/**
	 * Optional persistent store for Monitor task `lastRunMsecsSinceEpoch`.
	 * When provided, the factory hydrates each task's last-run timestamp on
	 * Monitor construction and snapshots back after every `runOnce` cycle.
	 * Without it, every fresh Monitor starts at lastRun=0 and re-fires every
	 * task on first invocation.
	 */
	taskStateStore?: TaskStateStore
	/**
	 * Optional override for the OneSatServices base URL. Falls through to
	 * ONESAT_MAINNET_URL / ONESAT_TESTNET_URL when undefined. Used by
	 * runtime wrappers (e.g. wallet-node) to surface an env-var override
	 * so a test deployment can point a CLI at a non-production 1sat-stack
	 * without recompiling.
	 */
	servicesBaseUrl?: string
}

export interface WalletCoreResult {
	wallet: InstanceType<any>
	services: OneSatServices
	storage: InstanceType<any>
	/**
	 * Present only when the caller supplies a `Monitor` class in the toolbox
	 * (wallet-node, wallet-browser). wallet-remote omits the class
	 * (`monitor: undefined`). Local-active includes default chain tasks plus
	 * BackupSync; remote-active is BackupSync-only (server owns chain work).
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
	getActiveStorage: () => WalletStorageProviderLike
	feeModel: { model: 'sat/kb'; value: number }
}

export async function createWalletCore(
	config: WalletCoreConfig,
	localStorage: WalletStorageProviderLike | undefined,
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
	const oneSatServices = new OneSatServices(
		chain,
		config.servicesBaseUrl,
		fallbackServices,
	)

	// 2. Create storage manager — empty initially
	const storage = new toolbox.WalletStorageManager(identityPubKey)

	// 3. Create wallet (needed for StorageClient auth)
	const wallet = new toolbox.Wallet({
		chain,
		keyDeriver,
		storage,
		services: oneSatServices,
	})

	// 4. Connect remotes
	const remoteClients: InstanceType<typeof toolbox.StorageClient>[] = []

	const connectRemote = async (url: string) => {
		const client = new toolbox.StorageClient(
			wallet as unknown as WalletInterface,
			url,
		)
		installStorageClientPaymentAutoRetry({
			client,
			wallet: wallet as unknown as WalletInterface,
			storage: storage as unknown as Parameters<
				typeof installStorageClientPaymentAutoRetry
			>[0]['storage'],
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

	// `intendedActiveKey` is the store config names as active for this
	// wallet. Set as the stores register, updated by `setActiveStorage`
	// later. Every (re)assertion of it goes straight through
	// `storage.setActive`: a no-op when the stores already agree, and
	// wallet-toolbox's merge-and-flip when they don't — a divergent store's
	// data is copied into the chosen active BEFORE the pointer settles.
	let intendedActiveKey!: string

	/**
	 * Sync the active store to one registered backup, isolated: a failure
	 * is logged and never propagates — one bad backup must not affect the
	 * wallet or the other backups. A billed remote writer that answers 507
	 * is topped up out-of-band and re-synced by the payment auto-retry
	 * layer installed at connection, so no payment ever runs under the
	 * storage lock.
	 */
	const syncBackup = async (writer: unknown, name: string): Promise<void> => {
		try {
			const w = writer as {
				getSettings?: () => { storageIdentityKey?: string } | undefined
			}
			if (w.getSettings?.()?.storageIdentityKey === storage.getActiveStore())
				return
			await storage.syncToWriter(await storage.getAuth(), writer)
		} catch (e) {
			console.warn(`[wallet-core] backup sync failed for ${name}:`, e)
		}
	}

	/** Sync the active store to every registered backup, each isolated. */
	const syncBackups = async (): Promise<void> => {
		if (!storage.isActiveEnabled) return
		if (localStorage) await syncBackup(localStorage, 'local')
		for (const client of remoteClients) {
			await syncBackup(
				client,
				(client as { endpointUrl?: string }).endpointUrl ?? 'remote',
			)
		}
	}

	// Register every store, name the intended active from config, then
	// settle. Local registers as it is — its user row is the record of what
	// this wallet last believed, and when it carries data the remote never
	// received, that row is what drives the merge in `setActive`. A backup
	// that fails to connect is logged and skipped for the session (it's a
	// backup — its absence is degradation, not failure); it reconnects on
	// the next boot. Only the active store failing is fatal.
	if (localStorage) {
		await storage.addWalletStorageProvider(localStorage)
		intendedActiveKey = (await localStorage.makeAvailable()).storageIdentityKey
	}
	if (config.activeRemote) {
		const activeClient = await connectRemote(config.activeRemote)
		intendedActiveKey =
			activeClient.getSettings()?.storageIdentityKey ?? intendedActiveKey
	}
	for (const url of config.backups ?? []) {
		try {
			await connectRemote(url)
		} catch (e) {
			console.warn(`[wallet-core] backup unreachable, skipped: ${url}`, e)
		}
	}

	// When any store's user row disagrees with config, `setActive` merges
	// the divergent store into the chosen active and propagates the settled
	// state. When rows already agree, `setActive` is a no-op. Backup refresh
	// is not done at boot — it races first reads (balance) under runAsSync.
	// Callers drive BackupSync via monitor.runOnce() after the wallet is up.
	if (
		storage.getActiveStore() !== intendedActiveKey ||
		!storage.isActiveEnabled
	) {
		await storage.setActive(intendedActiveKey)
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
	// (server owns chain monitoring). When present, the task loop is still
	// caller-driven via startTasks / runOnce — factory just constructs tasks.
	//
	// Local-active: full default tasks (headers/proofs/…) plus BackupSync.
	// Remote-active: BackupSync only — chain monitoring stays on the server;
	// default tasks would hit StorageProvider APIs on a StorageClient and fail.
	let monitor: InstanceType<any> | undefined
	if (toolbox.Monitor) {
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
		if (!config.activeRemote) {
			monitor.addDefaultTasks()
		}

		// Periodic backup push (active → each backup), isolated per store.
		// Unlike updateBackups() (loud, all-or-nothing), failures don't abort
		// siblings. Billing 507s settle out-of-band via payment auto-retry.
		// Interval defaults to 5 min; trigger() no-ops until elapsed.
		const backupSyncIntervalMs = config.backupSyncIntervalMs ?? 5 * 60 * 1000
		if (backupSyncIntervalMs > 0) {
			monitor.addTask(
				buildBackupSyncTask(monitor, backupSyncIntervalMs, storage, {
					syncBackups,
				}),
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

		// Persist task state across processes. Hydrate on construction;
		// snapshot after each runOnce cycle. Most tasks just persist
		// `lastRunMsecsSinceEpoch` so their per-task interval throttle
		// survives a fresh Monitor. `TaskNewHeader` additionally persists its
		// queued chain-tip so the "wait one cycle before fetching proofs"
		// handshake can complete across CLI invocations / service-worker
		// wakes — without this, transient consumers always look like a
		// first-run and `TaskCheckForProofs` never fires.
		if (config.taskStateStore) {
			const store = config.taskStateStore
			const persisted = await store.load()
			for (const t of monitor._tasks) {
				const value = persisted[t.name]
				// Legacy shape: raw number = lastRunMsecsSinceEpoch.
				if (typeof value === 'number') {
					t.lastRunMsecsSinceEpoch = value
					continue
				}
				if (value && typeof value === 'object') {
					const v = value as { lastRun?: unknown }
					if (typeof v.lastRun === 'number') {
						t.lastRunMsecsSinceEpoch = v.lastRun
					}
					if (t.name === 'NewHeader') {
						const nh = value as {
							header?: unknown
							queuedHeader?: unknown
							queuedHeaderWhen?: unknown
						}
						const target = t as unknown as {
							header?: unknown
							queuedHeader?: unknown
							queuedHeaderWhen?: Date
						}
						if (nh.header) target.header = nh.header
						if (nh.queuedHeader) target.queuedHeader = nh.queuedHeader
						if (typeof nh.queuedHeaderWhen === 'string') {
							target.queuedHeaderWhen = new Date(nh.queuedHeaderWhen)
						}
					}
				}
			}
			const originalRunOnce = monitor.runOnce.bind(monitor)
			const newHeaderTask = monitor._tasks.find(
				(t: { name: string }) => t.name === 'NewHeader',
			) as { queuedHeader?: unknown } | undefined
			monitor.runOnce = async () => {
				// If we restored a queuedHeader from disk, the first pass of
				// originalRunOnce will trigger TaskNewHeader.runTask which calls
				// processNewBlockHeader, setting TaskCheckForProofs.checkNow=true.
				// But that flip happens AFTER Monitor.runOnce's trigger-eval phase,
				// so TaskCheckForProofs is already excluded from this pass's task
				// list. Daemons get a follow-up cycle to consume the flag; CLI /
				// service-worker consumers don't. Do a second pass inline when we
				// know the flag was just set.
				const hadQueuedHeader = !!newHeaderTask?.queuedHeader
				await originalRunOnce()
				if (hadQueuedHeader && !newHeaderTask?.queuedHeader) {
					await originalRunOnce()
				}
				const next: Record<string, unknown> = {}
				for (const t of monitor._tasks) {
					if (t.name === 'NewHeader') {
						const src = t as unknown as {
							header?: unknown
							queuedHeader?: unknown
							queuedHeaderWhen?: Date
						}
						next[t.name] = {
							lastRun: t.lastRunMsecsSinceEpoch,
							header: src.header ?? null,
							queuedHeader: src.queuedHeader ?? null,
							queuedHeaderWhen: src.queuedHeaderWhen?.toISOString() ?? null,
						}
					} else {
						next[t.name] = t.lastRunMsecsSinceEpoch
					}
				}
				await store.save(next)
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
		await storage.setActive(intendedActiveKey)
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

interface BackupSyncTaskOptions {
	/** Syncs the active store to every registered backup, each isolated. */
	syncBackups: () => Promise<void>
}

/**
 * Builds a plain-object Monitor task that periodically syncs the active
 * store to every registered backup, one at a time, each isolated so one
 * failing backup doesn't block the rest. Billed remote writers that
 * answer 507 are handled out-of-band by the payment auto-retry layer —
 * no payment runs under the storage lock.
 *
 * Shape-compatible with `WalletMonitorTask` so the factory doesn't import
 * the abstract class from whichever wallet-toolbox variant the caller
 * uses.
 */
function buildBackupSyncTask(
	monitor: any,
	triggerMsecs: number,
	storage: any,
	options: BackupSyncTaskOptions,
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
			return { run: true }
		},
		async runTask(): Promise<string> {
			const messages: string[] = []
			if (storage.getBackupStores().length > 0) {
				try {
					await options.syncBackups()
					messages.push('sync complete')
				} catch (err) {
					messages.push(`sync failed: ${(err as Error).message}`)
				}
			}
			return messages.join('; ') || 'no work'
		},
	}
}
