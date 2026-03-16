/**
 * High-level vault for protecting secrets with the Secure Enclave.
 *
 * How it works:
 *   1. P-256 key generated INSIDE the Secure Enclave (never leaves the chip)
 *   2. Key's opaque dataRepresentation saved to file (hardware-bound, useless elsewhere)
 *   3. To encrypt: ECDH with ephemeral key + SE public key → AES-256-GCM (no Touch ID)
 *   4. To decrypt: Touch ID → SE internal ECDH → AES-256-GCM decrypt
 */

import {
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	unlinkSync,
	writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import {
	checkAvailability,
	decrypt,
	deleteKey,
	encrypt,
	generateKey,
	listKeys,
} from './enclave'
import type { ProtectResult, UnlockResult, VaultEntry, VaultSummary } from './types'

const VAULT_DIR = process.env.SE_VAULT_DIR ?? resolve(homedir(), '.secure-enclave-vault')

const SAFE_LABEL = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,62}$/

function validateLabel(label: string): void {
	if (!SAFE_LABEL.test(label)) {
		throw new Error(
			`@1sat/vault: Invalid label "${label}". Labels must be 1-63 chars, alphanumeric/hyphens/underscores/dots, starting with alphanumeric.`,
		)
	}
}

function ensureVaultDir(): void {
	if (!existsSync(VAULT_DIR)) {
		mkdirSync(VAULT_DIR, { recursive: true, mode: 0o700 })
	}
}

function entryPath(label: string): string {
	return resolve(VAULT_DIR, `${label}.vault.json`)
}

/**
 * Protect a secret with the Secure Enclave.
 *
 * 1. Generates a P-256 key in the SE (or overwrites existing for this label)
 * 2. Encrypts the plaintext with ECIES (public key only — no Touch ID)
 * 3. Saves encrypted data + metadata to disk
 *
 * Touch ID is NOT required for encryption — only for decryption.
 */
export async function protectSecret(
	label: string,
	plaintext: string,
	metadata?: Record<string, string>,
): Promise<ProtectResult> {
	validateLabel(label)
	ensureVaultDir()

	const { publicKey } = await generateKey(label)
	const ciphertext = await encrypt(label, plaintext)

	const entry: VaultEntry = {
		ciphertext,
		metadata,
		publicKey: `${publicKey.slice(0, 40)}...`,
		createdAt: new Date().toISOString(),
	}

	writeFileSync(entryPath(label), JSON.stringify(entry, null, '\t'), { mode: 0o600 })
	return { publicKey }
}

/**
 * Unlock a protected secret using Touch ID + Secure Enclave.
 *
 * The ECDH key agreement happens INSIDE the Secure Enclave hardware.
 * The P-256 private key never leaves the chip.
 */
export async function unlockSecret(label: string): Promise<UnlockResult> {
	validateLabel(label)
	const path = entryPath(label)
	if (!existsSync(path)) {
		throw new Error(`@1sat/vault: No vault entry for "${label}"`)
	}

	const entry: VaultEntry = JSON.parse(readFileSync(path, 'utf-8'))
	const plaintext = await decrypt(label, entry.ciphertext)

	return { plaintext, metadata: entry.metadata }
}

/** Remove a secret from both disk and Secure Enclave */
export async function removeSecret(label: string): Promise<void> {
	validateLabel(label)
	await deleteKey(label)
	const path = entryPath(label)
	if (existsSync(path)) unlinkSync(path)
}

/** List all vault entries (does NOT require Touch ID) */
export function listSecrets(): VaultSummary[] {
	ensureVaultDir()
	const files = readdirSync(VAULT_DIR)
	return files
		.filter((f) => f.endsWith('.vault.json'))
		.map((f) => {
			const label = f.replace('.vault.json', '')
			const entry: VaultEntry = JSON.parse(readFileSync(resolve(VAULT_DIR, f), 'utf-8'))
			return {
				label,
				metadata: entry.metadata,
				createdAt: entry.createdAt,
			}
		})
}

export { checkAvailability, listKeys }
