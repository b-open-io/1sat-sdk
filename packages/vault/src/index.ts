// Vault factory

export { FileVaultStorage } from './file-storage'

// Provider interface (implement per-platform)
export type { VaultAvailability, VaultProvider } from './provider'

// Storage interface + default filesystem implementation
export type { VaultStorage } from './storage'
// Domain types
export type {
	ProtectResult,
	UnlockResult,
	VaultConfig,
	VaultEntry,
	VaultSummary,
} from './types'
export { createVault, type Vault } from './vault'
