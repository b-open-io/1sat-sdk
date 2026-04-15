// NOTE: Filesystem storage uses one file per transaction. This works well for
// desktop-scale usage (tens of thousands of txs) but could exhaust inodes on
// ext4 Linux partitions for heavy users (millions of txs). Long-term plan is
// to move this to a Zig native module backed by RocksDB (C API via @cImport),
// which eliminates the inode concern and handles the full blob size range well.

import {
	existsSync,
	mkdirSync,
	readFileSync,
	unlinkSync,
	writeFileSync,
} from 'node:fs'
import { resolve } from 'node:path'
import { BeefClient } from '@1sat/client'

export class BeefStore {
	private readonly dir: string
	private remote: BeefClient | undefined

	constructor(dir: string) {
		this.dir = dir
		mkdirSync(dir, { recursive: true })
	}

	configureRemote(baseUrl: string | undefined) {
		this.remote = baseUrl ? new BeefClient(baseUrl) : undefined
	}

	private subdir(txid: string): string {
		return resolve(this.dir, txid.slice(0, 2), txid.slice(2, 4))
	}

	private filePath(txid: string): string {
		return resolve(this.subdir(txid), `${txid}.beef`)
	}

	get(txid: string): Uint8Array | undefined {
		const path = this.filePath(txid)
		if (!existsSync(path)) return undefined
		return new Uint8Array(readFileSync(path))
	}

	put(txid: string, data: Uint8Array): void {
		const dir = this.subdir(txid)
		mkdirSync(dir, { recursive: true })
		writeFileSync(this.filePath(txid), data, { mode: 0o644 })
	}

	has(txid: string): boolean {
		return existsSync(this.filePath(txid))
	}

	delete(txid: string): void {
		const path = this.filePath(txid)
		if (existsSync(path)) unlinkSync(path)
	}

	async getWithFallback(txid: string): Promise<Uint8Array | undefined> {
		const local = this.get(txid)
		if (local) return local

		if (!this.remote) return undefined

		try {
			const beef = await this.remote.getBeef(txid)
			if (beef.byteLength > 0) {
				this.put(txid, beef)
				return beef
			}
		} catch {
			// remote unavailable
		}
		return undefined
	}
}
