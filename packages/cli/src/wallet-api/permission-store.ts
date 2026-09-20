/**
 * File-backed `IPermissionStore` for `1sat serve wallet-api`.
 *
 * One JSON document per wallet (`<dataDir>/permissions-<chain>.json`, mode
 * 0600) keyed by the canonical permission key string, mirroring the
 * IndexedDB store in `@1sat/wallet-browser`: `putGrant` upserts by key,
 * `findGrant` is an exact-key lookup, `listGrants` filters by originator
 * and/or type, and `deleteAllForOriginator` returns how many grants it
 * removed. Every operation reads the file fresh and writes it back
 * atomically (temp file + rename), so several instances over the same path
 * observe each other's writes.
 */

import {
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import {
	type IPermissionStore,
	type ListGrantsFilter,
	type PermissionKey,
	type StoredGrant,
	permissionKeyToString,
} from '@1sat/wallet'

const FILE_VERSION = 1

interface PermissionFile {
	version: number
	grants: Record<string, StoredGrant>
}

/** Where the CLI keeps wallet-api grants for a chain. */
export function permissionStorePath(dataDir: string, chain: string): string {
	return join(dataDir, `permissions-${chain}.json`)
}

export class FilePermissionStore implements IPermissionStore {
	constructor(private readonly path: string) {}

	async findGrant(key: PermissionKey): Promise<StoredGrant | null> {
		return this.load().grants[permissionKeyToString(key)] ?? null
	}

	async putGrant(grant: StoredGrant): Promise<void> {
		const file = this.load()
		file.grants[permissionKeyToString(grant.key)] = grant
		this.save(file)
	}

	async deleteGrant(key: PermissionKey): Promise<void> {
		const file = this.load()
		const id = permissionKeyToString(key)
		if (!(id in file.grants)) return
		delete file.grants[id]
		this.save(file)
	}

	async deleteAllForOriginator(originator: string): Promise<number> {
		const file = this.load()
		let removed = 0
		for (const [id, grant] of Object.entries(file.grants)) {
			if (grant.key.originator === originator) {
				delete file.grants[id]
				removed++
			}
		}
		if (removed > 0) this.save(file)
		return removed
	}

	async listGrants(filter?: ListGrantsFilter): Promise<StoredGrant[]> {
		const out: StoredGrant[] = []
		for (const grant of Object.values(this.load().grants)) {
			if (filter?.originator && grant.key.originator !== filter.originator)
				continue
			if (filter?.type && grant.key.type !== filter.type) continue
			out.push(grant)
		}
		return out
	}

	private load(): PermissionFile {
		if (!existsSync(this.path)) return { version: FILE_VERSION, grants: {} }
		const raw = readFileSync(this.path, 'utf8')
		const parsed = JSON.parse(raw) as Partial<PermissionFile>
		if (parsed.version !== FILE_VERSION) {
			throw new Error(
				`Unsupported permission store version ${String(parsed.version)} in ${this.path}`,
			)
		}
		return { version: FILE_VERSION, grants: parsed.grants ?? {} }
	}

	private save(file: PermissionFile): void {
		const dir = dirname(this.path)
		if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 })
		const tmp = `${this.path}.${process.pid}.tmp`
		writeFileSync(tmp, `${JSON.stringify(file, null, 2)}\n`, { mode: 0o600 })
		renameSync(tmp, this.path)
	}
}
