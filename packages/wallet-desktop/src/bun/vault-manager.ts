/**
 * Platform-aware vault manager.
 *
 * Wraps @1sat/vault + @1sat/wallet-mac to provide desktop key protection.
 * On macOS the Secure Enclave + Touch ID protects the root key.
 * Non-macOS platforms throw immediately — add a provider when ready.
 *
 * All operations are parameterized by accountId. The build channel is set
 * once via `initVaultChannel()` so each channel + account combination gets
 * its own Secure Enclave key pair.
 */
import { createVault, FileVaultStorage, type Vault } from '@1sat/vault'
import { isMacOS, SecureEnclaveProvider } from '@1sat/wallet-mac'
import { Utils } from 'electrobun/bun'

let buildChannel: string | undefined

/**
 * Set the build channel (dev, stable, canary).
 * Must be called once at startup before any vault operations.
 */
export function initVaultChannel(channel: string): void {
	buildChannel = channel
}

export function getBuildChannel(): string {
	if (!buildChannel) {
		throw new Error(
			'Vault channel not initialized — call initVaultChannel() first',
		)
	}
	return buildChannel
}

/**
 * Compute the vault label for a specific account + channel.
 * Format: `1sat-wallet-{accountId}-{channel}`
 */
export function vaultLabelForAccount(accountId: string): string {
	return `1sat-wallet-${accountId}-${getBuildChannel()}`
}

/**
 * The old single-account vault label format, used for migration detection.
 */
export function legacyVaultLabel(): string {
	return `1sat-wallet-root-key-${getBuildChannel()}`
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
	accountId: string,
	rootKeyHex: string,
): Promise<void> {
	await vault.protectSecret(vaultLabelForAccount(accountId), rootKeyHex)
}

export async function retrieveRootKey(
	vault: Vault,
	accountId: string,
): Promise<string> {
	const { plaintext } = await vault.unlockSecret(
		vaultLabelForAccount(accountId),
	)
	return plaintext
}

export function hasStoredKey(vault: Vault, accountId: string): boolean {
	const label = vaultLabelForAccount(accountId)
	return vault.listSecrets().some((s) => s.label === label)
}

export async function removeStoredKey(
	vault: Vault,
	accountId: string,
): Promise<void> {
	await vault.removeSecret(vaultLabelForAccount(accountId))
}
