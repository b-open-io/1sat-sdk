// Platform detection
export { assertSupported, isSupported } from './platform'

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
	VaultEntry,
	VaultSummary,
} from './types'
