// Vault factory
export { createVault, type Vault } from './vault'

// Provider interface (implement per-platform)
export type { VaultProvider, VaultAvailability } from './provider'

// Storage interface + default filesystem implementation
export type { VaultStorage } from './storage'
export { FileVaultStorage } from './file-storage'

// Domain types
export type {
	ProtectResult,
	UnlockResult,
	VaultConfig,
	VaultEntry,
	VaultSummary,
} from './types'
