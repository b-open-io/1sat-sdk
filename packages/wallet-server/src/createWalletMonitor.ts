import { OneSatServices } from '@1sat/client'
import {
	Monitor,
	StorageKnex,
	WalletStorageManager,
	type sdk as walletSdk,
} from '@bsv/wallet-toolbox'
import type { ChaintracksClientApi } from '@bsv/wallet-toolbox/out/src/services/chaintracker/chaintracks/Api/ChaintracksClientApi.js'
import { createLogger } from 'evlog'
import { type Knex, knex as makeKnex } from 'knex'

type FeeModel = walletSdk.StorageFeeModel

export interface WalletMonitorConfig {
	chain: 'main' | 'test'
	knex: Knex.Config
	/** 1sat-stack base URL used for default OneSatServices. Ignored when `services` is supplied. */
	onesatURL?: string
	/** Override chain services. Defaults to OneSatServices(chain, onesatURL). */
	services?: walletSdk.WalletServices
	/** Chaintracks client. Defaults to the one provided by OneSatServices. */
	chaintracks?: ChaintracksClientApi
	/** StorageKnex fee model. Defaults to { model: 'sat/kb', value: 1 }. */
	feeModel?: FeeModel
}

export interface WalletMonitorHandle {
	start(): Promise<void>
	stop(): Promise<void>
	get running(): boolean
}

/**
 * Builds and runs a wallet-toolbox Monitor daemon wired to OneSatServices by default.
 *
 * Intended entry point for `1sat serve monitor` and the monitor portion of `1sat serve`.
 */
export function createWalletMonitor(
	config: WalletMonitorConfig,
): WalletMonitorHandle {
	let knex: Knex | undefined
	let storage: StorageKnex | undefined
	let monitor: Monitor | undefined
	let tasksPromise: Promise<void> | undefined
	let started = false

	return {
		get running() {
			return started
		},

		async start() {
			if (started) return
			started = true

			const startLog = createLogger({ context: 'monitor' })
			startLog.set({ event: 'monitor_starting', chain: config.chain })

			try {
				knex = makeKnex(config.knex)

				storage = new StorageKnex({
					chain: config.chain,
					knex,
					feeModel: config.feeModel ?? { model: 'sat/kb', value: 1 },
					commissionSatoshis: 0,
					commissionPubKeyHex: undefined,
				})
				await storage.makeAvailable()

				const settings = await storage.getSettings()
				const manager = new WalletStorageManager(
					settings.storageIdentityKey,
					storage,
				)
				await manager.makeAvailable()

				const services =
					config.services ??
					(new OneSatServices(
						config.chain,
						config.onesatURL,
					) as unknown as walletSdk.WalletServices)
				manager.setServices(services)

				const chaintracks =
					config.chaintracks ??
					(services as unknown as { chaintracks?: ChaintracksClientApi })
						.chaintracks
				if (!chaintracks) {
					throw new Error(
						'createWalletMonitor: services does not expose `chaintracks`; pass `chaintracks` explicitly.',
					)
				}

				monitor = new Monitor({
					chain: config.chain,
					services,
					storage: manager,
					chaintracks,
					msecsWaitPerMerkleProofServiceReq: 500,
					taskRunWaitMsecs: 5000,
					abandonedMsecs: 5 * 60 * 1000,
					unprovenAttemptsLimitTest: 10,
					unprovenAttemptsLimitMain: 144,
					// Required by MonitorOptions. 0 means rebroadcast without limit;
					// a positive cap marks the req invalid once reached, which strands
					// transactions whose proof only arrives after the cap.
					maxRebroadcastAttempts: 0,
				})

				if (monitor._tasks.length === 0) monitor.addMultiUserTasks()

				tasksPromise = monitor.startTasks()

				startLog.set({
					event: 'monitor_started',
					taskCount: monitor._tasks.length,
					storageIdentityKey: settings.storageIdentityKey,
				})
				startLog.emit()
			} catch (err) {
				started = false
				startLog.set({ event: 'monitor_start_failed' })
				startLog.error(err as Error)
				throw err
			}
		},

		async stop() {
			if (!started) return
			started = false

			const stopLog = createLogger({ context: 'monitor' })
			stopLog.set({ event: 'monitor_stopping' })

			if (monitor) monitor.stopTasks()
			if (tasksPromise) {
				try {
					await tasksPromise
				} catch {
					// task promise rejects on shutdown in some configurations; ignore
				}
			}
			try {
				await monitor?.destroy()
			} catch {
				// destroy unsubscribes chaintracks listeners; failures here aren't fatal
			}
			if (storage) await storage.destroy()
			if (knex) await knex.destroy()

			monitor = undefined
			tasksPromise = undefined
			storage = undefined
			knex = undefined

			stopLog.set({ event: 'monitor_stopped' })
			stopLog.emit()
		},
	}
}
