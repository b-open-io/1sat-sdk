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
import { FileVaultStorage, type Vault, createVault } from '@1sat/vault'
import { SecureEnclaveProvider, isMacOS } from '@1sat/wallet-mac'
import { Utils } from 'electrobun/bun'
import { protectRootKeyOnce } from './vault-secret'

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
	identityKey: string,
	rootIdentityKey: string,
): Promise<void> {
	const label = vaultLabelForAccount(accountId)
	const existing = vault.listSecrets().find((secret) => secret.label === label)
	await protectRootKeyOnce({
		accountId,
		identityKey,
		label,
		rootIdentityKey,
		rootKeyHex,
		existing,
		unlock: (secretLabel) => vault.unlockSecret(secretLabel),
		protect: async (secretLabel, plaintext, metadata) => {
			await vault.protectSecret(secretLabel, plaintext, metadata)
		},
	})
}

export async function retrieveRootKey(
	vault: Vault,
	accountId: string,
	identityKey: string,
): Promise<{ rootKeyHex: string; rootIdentityKey?: string }> {
	const { plaintext, metadata } = await vault.unlockSecret(
		vaultLabelForAccount(accountId),
	)
	if (
		metadata &&
		(metadata.accountId !== accountId || metadata.identityKey !== identityKey)
	) {
		throw new Error('Vault account metadata does not match the wallet identity')
	}
	return {
		rootKeyHex: plaintext,
		rootIdentityKey: metadata?.rootIdentityKey,
	}
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
