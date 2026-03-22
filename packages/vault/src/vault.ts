import type { VaultProvider } from './provider'
import type { VaultStorage } from './storage'
import type { ProtectResult, UnlockResult, VaultSummary } from './types'

const SAFE_LABEL = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,62}$/

function validateLabel(label: string): void {
	if (!SAFE_LABEL.test(label)) {
		throw new Error(
			`Invalid label "${label}". Labels must be 1-63 chars, alphanumeric start, then alphanumeric/hyphens/underscores/dots.`,
		)
	}
}

export interface Vault {
	protectSecret(
		label: string,
		plaintext: string,
		metadata?: Record<string, string>,
	): Promise<ProtectResult>
	unlockSecret(label: string): Promise<UnlockResult>
	removeSecret(label: string): Promise<void>
	listSecrets(): VaultSummary[]
}

export function createVault(
	provider: VaultProvider,
	storage: VaultStorage,
): Vault {
	return {
		async protectSecret(label, plaintext, metadata) {
			validateLabel(label)
			const { publicKey } = await provider.generateKey(label)
			const ciphertext = await provider.encrypt(label, plaintext)
			storage.write(label, {
				ciphertext,
				metadata,
				publicKey,
				createdAt: new Date().toISOString(),
			})
			return { publicKey }
		},

		async unlockSecret(label) {
			validateLabel(label)
			const entry = storage.read(label)
			if (!entry) throw new Error(`No vault entry for "${label}"`)
			const plaintext = await provider.decrypt(label, entry.ciphertext)
			return { plaintext, metadata: entry.metadata }
		},

		async removeSecret(label) {
			validateLabel(label)
			await provider.deleteKey(label)
			storage.remove(label)
		},

		listSecrets() {
			return storage.list()
		},
	}
}
