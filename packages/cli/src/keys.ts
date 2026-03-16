/**
 * Encrypted key management for the 1sat CLI.
 *
 * Key resolution priority:
 * 1. PRIVATE_KEY_WIF env var (headless/CI)
 * 2. Touch ID cached password → decrypt keys.bep (macOS arm64)
 * 3. Explicit password → decrypt keys.bep
 * 4. Fail with guidance
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { arch, platform } from 'node:os'
import { join } from 'node:path'
import { PrivateKey } from '@bsv/sdk'
import { type WifBackup, decryptBackup, encryptBackup } from 'bitcoin-backup'
import { ensureConfigDir, getConfigDir } from './config'

const KEYS_FILE = 'keys.bep'

function getKeysPath(): string {
	return join(getConfigDir(), KEYS_FILE)
}

/**
 * Check if a key is available (env var or encrypted file).
 */
export function hasKey(): boolean {
	if (process.env.PRIVATE_KEY_WIF) return true
	return existsSync(getKeysPath())
}

/**
 * Check if Touch ID is available for password caching.
 */
export function isTouchIDAvailable(): boolean {
	return platform() === 'darwin' && arch() === 'arm64'
}

/**
 * Load the private key from env, Touch ID cache, or password.
 *
 * Resolution order:
 * 1. PRIVATE_KEY_WIF env var
 * 2. Touch ID cached password (if available)
 * 3. Explicit password parameter
 */
export async function loadKey(password?: string): Promise<PrivateKey> {
	// Priority 1: Environment variable
	const envWif = process.env.PRIVATE_KEY_WIF
	if (envWif) {
		return PrivateKey.fromWif(envWif)
	}

	// Priority 2: Encrypted file
	const keysPath = getKeysPath()
	if (!existsSync(keysPath)) {
		throw new Error(
			'No key found. Run "1sat init" to set up your wallet, or set PRIVATE_KEY_WIF.',
		)
	}

	const encrypted = readFileSync(keysPath, 'utf8')

	// Priority 2a: Try Touch ID cached password
	let resolvedPassword = password
	if (!resolvedPassword) {
		try {
			const { getCachedPassword } = await import('bitcoin-backup')
			const cached = await getCachedPassword(keysPath)
			if (cached) {
				resolvedPassword = cached
			}
		} catch {
			// Touch ID not available or no cached password — fall through
		}
	}

	if (!resolvedPassword) {
		throw new Error(
			'Password required to decrypt key file. Pass --password, set ONESAT_PASSWORD, or run "1sat init --touchid" to enable Touch ID.',
		)
	}

	const backup = await decryptBackup(encrypted, resolvedPassword)
	if (!('wif' in backup) || typeof backup.wif !== 'string') {
		throw new Error('Key file does not contain a WIF key.')
	}
	return PrivateKey.fromWif(backup.wif)
}

/**
 * Save a WIF-encoded private key to encrypted file.
 */
export async function saveKey(wif: string, password: string): Promise<void> {
	ensureConfigDir()

	// Validate the WIF before saving
	PrivateKey.fromWif(wif)

	const payload: WifBackup = {
		wif,
		label: '1sat-cli',
		createdAt: new Date().toISOString(),
	}
	const encrypted = await encryptBackup(payload, password)
	const keysPath = getKeysPath()
	writeFileSync(keysPath, encrypted, { mode: 0o600 })
}

/**
 * Cache the password for keys.bep using Touch ID.
 */
export async function cacheKeyPassword(password: string): Promise<void> {
	const { cachePassword } = await import('bitcoin-backup')
	await cachePassword(getKeysPath(), password)
}

/**
 * Remove the cached password for keys.bep.
 */
export async function forgetKeyPassword(): Promise<void> {
	const { forgetPassword } = await import('bitcoin-backup')
	await forgetPassword(getKeysPath())
}

/**
 * Resolve a password from flag or environment variable.
 */
export function resolvePassword(flagValue?: string): string | undefined {
	return flagValue ?? process.env.ONESAT_PASSWORD
}
