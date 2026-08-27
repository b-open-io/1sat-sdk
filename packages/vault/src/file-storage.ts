import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	unlinkSync,
	writeFileSync,
} from 'node:fs'
import { resolve } from 'node:path'
import type { VaultStorage } from './storage'
import type { VaultEntry, VaultSummary } from './types'

export class FileVaultStorage implements VaultStorage {
	private readonly dir: string

	constructor(dir: string) {
		this.dir = dir
		if (!existsSync(this.dir)) {
			mkdirSync(this.dir, { recursive: true, mode: 0o700 })
		}
	}

	private entryPath(label: string): string {
		return resolve(this.dir, `${label}.vault.json`)
	}

	read(label: string): VaultEntry | null {
		const path = this.entryPath(label)
		if (!existsSync(path)) return null
		return JSON.parse(readFileSync(path, 'utf-8'))
	}

	write(label: string, entry: VaultEntry): void {
		writeFileSync(this.entryPath(label), JSON.stringify(entry, null, '\t'), {
			mode: 0o600,
		})
	}

	remove(label: string): void {
		const path = this.entryPath(label)
		if (existsSync(path)) unlinkSync(path)
	}

	list(): VaultSummary[] {
		const files = readdirSync(this.dir)
		return files
			.filter((f) => f.endsWith('.vault.json'))
			.map((f) => {
				const label = f.replace('.vault.json', '')
				const entry: VaultEntry = JSON.parse(
					readFileSync(resolve(this.dir, f), 'utf-8'),
				)
				return {
					label,
					metadata: entry.metadata,
					createdAt: entry.createdAt,
				}
			})
	}
}
