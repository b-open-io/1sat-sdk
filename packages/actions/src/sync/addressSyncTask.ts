/**
 * Duck-typed WalletMonitorTask that runs {@link syncAddresses}.
 * Same shape as BackupSync in `@1sat/wallet` — do not subclass
 * toolbox `WalletMonitorTask` (avoids importing a wallet-toolbox variant).
 */

export const DEFAULT_ADDRESS_SYNC_INTERVAL_MS = 60_000

export const ADDRESS_SYNC_TASK_NAME = 'AddressSync'

export interface AddressSyncTaskOptions {
	/** Called when the task is due. Typically `() => syncAddresses.execute(ctx, input)`. */
	run: () => Promise<unknown>
}

export interface AddressSyncMonitorTask {
	monitor: unknown
	storage: unknown
	name: string
	lastRunMsecsSinceEpoch: number
	asyncSetup: () => Promise<void>
	trigger: (nowMsecsSinceEpoch: number) => { run: boolean }
	runTask: () => Promise<string>
}

/**
 * Builds a monitor task that periodically internalizes payments to
 * BRC-29 deposit addresses. Add it after wallet create, then call
 * `monitor.runOnce()` — the factory's boot `runOnce` runs before
 * callers can `addTask`.
 *
 * Interval defaults to 60s. `trigger()` no-ops until elapsed; persist
 * `lastRun` via `taskStateStore` so service-worker restarts respect it.
 */
export function buildAddressSyncTask(
	monitor: { storage?: unknown },
	triggerMsecs: number,
	options: AddressSyncTaskOptions,
): AddressSyncMonitorTask {
	const interval = triggerMsecs > 0 ? triggerMsecs : DEFAULT_ADDRESS_SYNC_INTERVAL_MS
	return {
		monitor,
		storage: monitor.storage,
		name: ADDRESS_SYNC_TASK_NAME,
		lastRunMsecsSinceEpoch: 0,
		async asyncSetup() {},
		trigger(nowMsecsSinceEpoch: number): { run: boolean } {
			if (nowMsecsSinceEpoch - this.lastRunMsecsSinceEpoch < interval) {
				return { run: false }
			}
			return { run: true }
		},
		async runTask(): Promise<string> {
			try {
				await options.run()
				return 'sync complete'
			} catch (err) {
				return `sync failed: ${(err as Error).message}`
			}
		},
	}
}
