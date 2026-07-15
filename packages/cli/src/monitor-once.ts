/**
 * Detached one-shot monitor run for CLI commands.
 *
 * Parent commands skip in-process monitor.runOnce() so toolbox/console noise
 * never hits the TTY. After the wallet is closed they spawn this process;
 * its stdout/stderr append to <dataDir>/monitor.log.
 */

import { type SpawnOptions, spawn } from 'node:child_process'
import { appendFileSync, closeSync, openSync } from 'node:fs'
import { join } from 'node:path'
import { createNodeWallet } from '@1sat/wallet-node'
import { ensureDataDir, loadConfig } from './config'
import { loadKey } from './keys'
import {
	clearMonitorPid,
	readLiveMonitorPid,
	writeMonitorPid,
} from './monitor-lock'

export const MONITOR_LOG_FILENAME = 'monitor.log'

export function monitorLogPath(dataDir: string): string {
	return join(dataDir, MONITOR_LOG_FILENAME)
}

/**
 * Spawn a detached `__monitor-once` child. No-op when a live monitor owner
 * exists (serve or another once-run) or when a remote is the active store.
 * Spawn failures are reported on the parent stderr; child logs go to file.
 */
export function spawnDetachedMonitorOnce(opts: {
	dataDir: string
	chain: 'main' | 'test'
	privateKeyWif: string
	activeRemote?: string
}): void {
	if (opts.activeRemote) return
	if (readLiveMonitorPid(opts.dataDir) !== undefined) return

	const logPath = monitorLogPath(opts.dataDir)
	try {
		appendFileSync(
			logPath,
			`\n--- monitor-once ${new Date().toISOString()} ---\n`,
		)
	} catch {
		// still try to spawn; openSync may surface the real error
	}

	let logFd: number
	try {
		logFd = openSync(logPath, 'a')
	} catch (err) {
		console.error(
			`[monitor] failed to open log ${logPath}: ${(err as Error).message}`,
		)
		return
	}

	const args = ['__monitor-once', '--chain', opts.chain]
	const env: NodeJS.ProcessEnv = {
		...process.env,
		DOTENV_CONFIG_QUIET: 'true',
		PRIVATE_KEY_WIF: opts.privateKeyWif,
	}

	try {
		const child = spawnSelf(args, {
			detached: true,
			stdio: ['ignore', logFd, logFd],
			env,
		})
		child.unref()
	} catch (err) {
		console.error(
			`[monitor] failed to start background run: ${(err as Error).message}`,
		)
	} finally {
		closeSync(logFd)
	}
}

function spawnSelf(args: string[], options: SpawnOptions) {
	const script = process.argv[1]
	if (
		script &&
		(script.endsWith('.ts') ||
			script.endsWith('.tsx') ||
			script.endsWith('.js') ||
			script.endsWith('.mjs') ||
			script.endsWith('.cjs'))
	) {
		return spawn(process.execPath, [script, ...args], options)
	}
	return spawn(process.execPath, args, options)
}

/**
 * Child entry: open the wallet, run monitor once, exit. Claims monitor.pid
 * while running so concurrent CLI spawns skip; clears only if we still own it.
 */
export async function runMonitorOnce(chain: 'main' | 'test'): Promise<void> {
	const config = loadConfig()
	if (config.activeRemote) return

	const dataDir = ensureDataDir()
	const existing = readLiveMonitorPid(dataDir)
	if (existing !== undefined && existing !== process.pid) return

	const privateKey = await loadKey()
	writeMonitorPid(dataDir)
	try {
		const storageIdentityKey = config.storageIdentityKey ?? '1sat-cli-default'
		const walletResult = await createNodeWallet({
			privateKey,
			chain,
			storageIdentityKey,
			storage: {
				provider: 'bun-sqlite',
				filename: `${dataDir}/wallet-${chain}.db`,
			},
			activeRemote: config.activeRemote,
			backups: config.backups,
			skipInitialMonitor: true,
		})
		try {
			await walletResult.monitor.runOnce()
		} finally {
			await walletResult.destroy()
		}
	} finally {
		clearMonitorPid(dataDir, process.pid)
	}
}
