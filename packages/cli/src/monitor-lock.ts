/**
 * PID lock file coordinating a single monitor owner across CLI invocations
 * and a long-running `1sat serve` process.
 *
 * - `1sat serve` (modes that run the monitor) writes the pid on startup and
 *   removes it on clean shutdown.
 * - CLI invocations read the file and, if the pid is alive, skip firing
 *   their own `monitor.runOnce()` to avoid duplicate work against the same
 *   SQLite file.
 */

import { readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const MONITOR_PID_FILENAME = 'monitor.pid'

export function monitorPidPath(dataDir: string): string {
	return join(dataDir, MONITOR_PID_FILENAME)
}

export function writeMonitorPid(
	dataDir: string,
	pid: number = process.pid,
): void {
	writeFileSync(monitorPidPath(dataDir), `${pid}\n`, 'utf8')
}

export function clearMonitorPid(dataDir: string): void {
	try {
		unlinkSync(monitorPidPath(dataDir))
	} catch {}
}

/** Returns the pid of a live monitor owner, or undefined if none. */
export function readLiveMonitorPid(dataDir: string): number | undefined {
	let raw: string
	try {
		raw = readFileSync(monitorPidPath(dataDir), 'utf8')
	} catch {
		return undefined
	}
	const pid = Number.parseInt(raw.trim(), 10)
	if (!Number.isInteger(pid) || pid <= 0) return undefined
	try {
		process.kill(pid, 0)
		return pid
	} catch {
		return undefined
	}
}
