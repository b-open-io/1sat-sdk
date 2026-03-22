import type { VaultEntry, VaultSummary } from './types'

export interface VaultStorage {
	read(label: string): VaultEntry | null
	write(label: string, entry: VaultEntry): void
	remove(label: string): void
	list(): VaultSummary[]
}
