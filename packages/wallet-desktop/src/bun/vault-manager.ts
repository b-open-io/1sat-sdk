/**
 * Platform-aware vault manager.
 *
 * Wraps @1sat/vault + @1sat/wallet-mac to provide desktop key protection.
 * On macOS the Secure Enclave + Touch ID protects the root key.
 * Non-macOS platforms throw immediately — add a provider when ready.
 */
import { FileVaultStorage, type Vault, createVault } from "@1sat/vault"
import { SecureEnclaveProvider, isMacOS } from "@1sat/wallet-mac"
import { Utils } from "electrobun/bun"

const VAULT_LABEL = "1sat-wallet-root-key"

export function createDesktopVault(): Vault {
	const vaultDir = `${Utils.paths.userData}/vault`
	const storage = new FileVaultStorage(vaultDir)

	if (!isMacOS()) {
		throw new Error(
			"Non-macOS vault provider not yet implemented. Currently macOS-only.",
		)
	}

	const provider = new SecureEnclaveProvider({ name: "1Sat Wallet" })
	return createVault(provider, storage)
}

export async function protectRootKey(
	vault: Vault,
	rootKeyHex: string,
): Promise<void> {
	await vault.protectSecret(VAULT_LABEL, rootKeyHex)
}

export async function retrieveRootKey(vault: Vault): Promise<string> {
	const { plaintext } = await vault.unlockSecret(VAULT_LABEL)
	return plaintext
}

export function hasStoredKey(vault: Vault): boolean {
	const secrets = vault.listSecrets()
	return secrets.some((s) => s.label === VAULT_LABEL)
}

export async function removeStoredKey(vault: Vault): Promise<void> {
	await vault.removeSecret(VAULT_LABEL)
}
