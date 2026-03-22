export interface VaultEntry {
	ciphertext: string
	metadata?: Record<string, string>
	publicKey: string
	createdAt: string
}

export interface VaultSummary {
	label: string
	metadata?: Record<string, string>
	createdAt: string
}

export interface UnlockResult {
	plaintext: string
	metadata?: Record<string, string>
}

export interface ProtectResult {
	publicKey: string
}

export interface VaultConfig {
	/** Display name for error messages (default: "@1sat/vault"). */
	name?: string
}
