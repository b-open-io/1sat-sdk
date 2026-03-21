// Platform detection
export { assertSupported, isSupported } from './platform'

// Configuration
export { configureVault } from './enclave'

// Low-level Secure Enclave operations
export {
	checkAvailability,
	decrypt,
	deleteKey,
	encrypt,
	generateKey,
	listKeys,
} from './enclave'

// High-level vault
export {
	listSecrets,
	protectSecret,
	removeSecret,
	unlockSecret,
} from './vault'

// Types
export type {
	HelperResult,
	ProtectResult,
	SEAvailability,
	UnlockResult,
	VaultConfig,
	VaultEntry,
	VaultSummary,
} from './types'
