/**
 * Encrypted key management for the 1sat CLI.
 *
 * Key resolution priority:
 * 1. PRIVATE_KEY_WIF env var
 * 2. ~/.1sat/keys.bep encrypted file
 * 3. Fail with "Run 1sat init"
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
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
 * Load the private key from env or encrypted file.
 *
 * @param password - Required if loading from encrypted file
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

	if (!password) {
		throw new Error(
			'Password required to decrypt key file. Pass --password or set ONESAT_PASSWORD.',
		)
	}

	const encrypted = readFileSync(keysPath, 'utf8')
	const backup = await decryptBackup(encrypted, password)
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
 * Resolve a password from flag or environment variable.
 */
export function resolvePassword(flagValue?: string): string | undefined {
	return flagValue ?? process.env.ONESAT_PASSWORD
}
