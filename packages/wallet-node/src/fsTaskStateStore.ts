import { promises as fs } from 'node:fs'
import { dirname } from 'node:path'
import type { TaskStateStore } from '@1sat/wallet'

/**
 * Filesystem-backed `TaskStateStore`. Stores the task state map as JSON at
 * the given path. Writes are atomic via temp-file-and-rename, so two
 * processes writing concurrently never produce a torn file (last writer
 * wins, which is correct for monotonically advancing timestamps).
 *
 * Per-task value interpretation lives in the wallet factory; this store is
 * an opaque blob carrier for whatever JSON-serializable shape the factory
 * decides to persist.
 */
export function createFsTaskStateStore(filePath: string): TaskStateStore {
	return {
		async load() {
			try {
				const raw = await fs.readFile(filePath, 'utf8')
				const parsed = JSON.parse(raw)
				if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
					return parsed as Record<string, unknown>
				}
				return {}
			} catch (err) {
				if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {}
				throw err
			}
		},
		async save(state) {
			await fs.mkdir(dirname(filePath), { recursive: true })
			const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`
			await fs.writeFile(tmp, JSON.stringify(state), 'utf8')
			await fs.rename(tmp, filePath)
		},
	}
}
