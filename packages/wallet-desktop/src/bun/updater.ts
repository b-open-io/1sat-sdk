/**
 * Auto-updater — wraps Electrobun's Updater API with evlog logging
 * and RPC-based status pushes to the frontend.
 */
import { createLogger } from 'evlog'
import { Updater } from 'electrobun/bun'
import type { UpdateStatusKind } from '../shared/types'

// Callback to push update status to the frontend via RPC
let pushStatus: ((status: UpdateStatusKind, version?: string, error?: string) => void) | null = null

/** Register the RPC push callback — called once from index.ts after RPC is wired */
export function setUpdateStatusPusher(
	fn: (status: UpdateStatusKind, version?: string, error?: string) => void,
) {
	pushStatus = fn
}

function notify(status: UpdateStatusKind, version?: string, error?: string) {
	pushStatus?.(status, version, error)
}

/**
 * Silent update check — used on launch and by the hourly interval.
 * Does NOT apply automatically; sends 'ready' status so the frontend
 * can prompt the user to restart.
 */
export async function checkForUpdatesOnLaunch(): Promise<void> {
	const log = createLogger({ context: 'updater' })

	try {
		log.set({ event: 'check_start', trigger: 'launch' })
		log.emit()

		const result = await Updater.checkForUpdate()

		log.set({
			event: 'check_result',
			updateAvailable: result.updateAvailable,
			version: result.version,
			hash: result.hash,
		})
		log.emit()

		if (!result.updateAvailable) {
			notify('up-to-date')
			return
		}

		notify('downloading', result.version)

		const dlLog = createLogger({ context: 'updater' })
		dlLog.set({ event: 'download_start', version: result.version })
		dlLog.emit()

		await Updater.downloadUpdate()

		const info = Updater.updateInfo()

		if (info?.updateReady) {
			const readyLog = createLogger({ context: 'updater' })
			readyLog.set({ event: 'update_ready', version: result.version })
			readyLog.emit()
			notify('ready', result.version)
		} else {
			const errMsg = info?.error ?? 'Download completed but update not ready'
			const errLog = createLogger({ context: 'updater' })
			errLog.set({ event: 'download_not_ready', error: errMsg })
			errLog.emit()
			notify('error', result.version, errMsg)
		}
	} catch (err) {
		const errMsg = err instanceof Error ? err.message : String(err)
		const errLog = createLogger({ context: 'updater' })
		errLog.set({ event: 'check_failed', error: errMsg })
		errLog.emit()
		notify('error', undefined, errMsg)
	}
}

/**
 * Manual check — triggered by the user via RPC or app menu.
 * Pushes granular status updates so the frontend can show progress.
 */
export async function checkForUpdatesManual(): Promise<void> {
	const log = createLogger({ context: 'updater' })

	try {
		notify('checking')
		log.set({ event: 'check_start', trigger: 'manual' })
		log.emit()

		const result = await Updater.checkForUpdate()

		log.set({
			event: 'check_result',
			updateAvailable: result.updateAvailable,
			version: result.version,
		})
		log.emit()

		if (!result.updateAvailable) {
			notify('up-to-date')
			return
		}

		notify('downloading', result.version)

		await Updater.downloadUpdate()

		const info = Updater.updateInfo()

		if (info?.updateReady) {
			const readyLog = createLogger({ context: 'updater' })
			readyLog.set({ event: 'update_ready', version: result.version })
			readyLog.emit()
			notify('ready', result.version)
		} else {
			const errMsg = info?.error ?? 'Download completed but update not ready'
			const errLog = createLogger({ context: 'updater' })
			errLog.set({ event: 'download_not_ready', error: errMsg })
			errLog.emit()
			notify('error', result.version, errMsg)
		}
	} catch (err) {
		const errMsg = err instanceof Error ? err.message : String(err)
		const errLog = createLogger({ context: 'updater' })
		errLog.set({ event: 'manual_check_failed', error: errMsg })
		errLog.emit()
		notify('error', undefined, errMsg)
	}
}

/**
 * Apply a downloaded update — replaces the app bundle and restarts.
 */
export async function applyUpdate(): Promise<void> {
	const log = createLogger({ context: 'updater' })
	log.set({ event: 'apply_update' })
	log.emit()
	await Updater.applyUpdate()
}

/**
 * Returns the local build info (version, channel, hash).
 */
export async function getAppVersionInfo(): Promise<{
	version: string
	channel: string
	hash: string
}> {
	const [version, channel, hash] = await Promise.all([
		Updater.localInfo.version(),
		Updater.localInfo.channel(),
		Updater.localInfo.hash(),
	])
	return { version, channel, hash }
}

/** Interval handle for the hourly background check */
let backgroundInterval: ReturnType<typeof setInterval> | null = null

/** Start the hourly background update check */
export function startBackgroundUpdateCheck(): void {
	if (backgroundInterval) return
	backgroundInterval = setInterval(() => {
		checkForUpdatesOnLaunch()
	}, 60 * 60 * 1000) // every hour
}

/** Stop the background update check (call on quit) */
export function stopBackgroundUpdateCheck(): void {
	if (backgroundInterval) {
		clearInterval(backgroundInterval)
		backgroundInterval = null
	}
}
