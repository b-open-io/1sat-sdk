/**
 * Encrypted key management for the 1sat CLI.
 *
 * Key resolution priority inside loadKey():
 * 1. PRIVATE_KEY_WIF env var (headless/CI)
 * 2. ONESAT_PASSWORD env var → decrypt keys.bep
 * 3. Interactive TTY prompt → decrypt keys.bep
 * 4. Fail with guidance
 *
 * A biometric vault tier will be added once @1sat/wallet-mac is
 * CLI-ready (resolves its own enclave binary relative to its module
 * directory instead of wallet-desktop's layout).
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { PrivateKey } from '@bsv/sdk'
import { isCancel, password as promptPassword } from '@clack/prompts'
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
 * Load the private key from env, env password, or TTY prompt.
 */
export async function loadKey(): Promise<PrivateKey> {
	const envWif = process.env.PRIVATE_KEY_WIF
	if (envWif) {
		return PrivateKey.fromWif(envWif)
	}

	const keysPath = getKeysPath()
	if (!existsSync(keysPath)) {
		throw new Error(
			'No key found. Run "1sat init" to set up your wallet, or set PRIVATE_KEY_WIF.',
		)
	}

	const encrypted = readFileSync(keysPath, 'utf8')

	let resolvedPassword = process.env.ONESAT_PASSWORD

	if (!resolvedPassword) {
		if (!process.stdin.isTTY) {
			throw new Error(
				'Password required to decrypt key file. Set ONESAT_PASSWORD or run in an interactive terminal.',
			)
		}
		const input = await promptPassword({
			message: 'Password:',
		})
		if (isCancel(input) || typeof input !== 'string' || input.length === 0) {
			throw new Error('Password required to decrypt key file.')
		}
		resolvedPassword = input
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
	PrivateKey.fromWif(wif)

	const payload: WifBackup = {
		wif,
		label: '1sat-cli',
		createdAt: new Date().toISOString(),
	}
	const encrypted = await encryptBackup(payload, password)
	writeFileSync(getKeysPath(), encrypted, { mode: 0o600 })
}
