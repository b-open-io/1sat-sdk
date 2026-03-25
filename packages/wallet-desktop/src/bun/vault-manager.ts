/**
 * Platform-aware vault manager.
 *
 * Wraps @1sat/vault + @1sat/wallet-mac to provide desktop key protection.
 * On macOS the Secure Enclave + Touch ID protects the root key.
 * Non-macOS platforms throw immediately — add a provider when ready.
 *
 * The vault label is set once via `initVaultLabel()` before any operations.
 * Different build channels (dev, stable, canary) should use distinct labels
 * so each channel gets its own Secure Enclave key pair.
 */
import { FileVaultStorage, type Vault, createVault } from '@1sat/vault'
import { SecureEnclaveProvider, isMacOS } from '@1sat/wallet-mac'
import { Utils } from 'electrobun/bun'

let vaultLabel: string | undefined

/**
 * Set the vault label used for all SE key operations.
 * Must be called once before checkVault / create / unlock.
 */
export function initVaultLabel(label: string): void {
	vaultLabel = label
}

function getLabel(): string {
	if (!vaultLabel) {
		throw new Error('Vault label not initialized — call initVaultLabel() first')
	}
	return vaultLabel
}

export function createDesktopVault(): Vault {
	const vaultDir = `${Utils.paths.userData}/vault`
	const storage = new FileVaultStorage(vaultDir)

	if (!isMacOS()) {
		throw new Error(
			'Non-macOS vault provider not yet implemented. Currently macOS-only.',
		)
	}

	const provider = new SecureEnclaveProvider({ name: '1Sat' })
	return createVault(provider, storage)
}

export async function protectRootKey(
	vault: Vault,
	rootKeyHex: string,
): Promise<void> {
	await vault.protectSecret(getLabel(), rootKeyHex)
}

export async function retrieveRootKey(vault: Vault): Promise<string> {
	const { plaintext } = await vault.unlockSecret(getLabel())
	return plaintext
}

export function hasStoredKey(vault: Vault): boolean {
	const secrets = vault.listSecrets()
	return secrets.some((s) => s.label === getLabel())
}

export async function removeStoredKey(vault: Vault): Promise<void> {
	await vault.removeSecret(getLabel())
}
