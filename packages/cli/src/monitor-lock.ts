/**
 * PID lock file coordinating a single monitor owner across CLI invocations
 * and a long-running `1sat serve` process.
 *
 * - `1sat serve` (modes that run the monitor) writes the pid on startup and
 *   removes it on clean shutdown (only if still the owner).
 * - Detached `__monitor-once` children claim the same lock while they run.
 * - CLI parents skip spawning another once-run when a live owner is present.
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

/**
 * Remove the pid file. When `onlyPid` is set, only unlink if the file still
 * contains that pid (avoids a short once-run clearing a serve owner that
 * started while the once-run was shutting down).
 */
export function clearMonitorPid(dataDir: string, onlyPid?: number): void {
	const path = monitorPidPath(dataDir)
	try {
		if (onlyPid !== undefined) {
			const raw = readFileSync(path, 'utf8')
			const pid = Number.parseInt(raw.trim(), 10)
			if (pid !== onlyPid) return
		}
		unlinkSync(path)
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
