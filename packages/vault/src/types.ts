export interface HelperResult {
	success: boolean
	data?: string
	error?: string
	meta?: Record<string, string>
}

export interface SEAvailability {
	secureEnclave: boolean
	biometryType: string
	biometryAvailable: boolean
	vaultDir: string
}

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
