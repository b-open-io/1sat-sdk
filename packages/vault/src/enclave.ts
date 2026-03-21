/**
 * Low-level Secure Enclave operations via CryptoKit Swift binary.
 *
 * The SE private key NEVER leaves the Secure Enclave chip.
 * Key persistence uses CryptoKit dataRepresentation files (opaque, hardware-bound).
 * No entitlements, no signing, no .app bundle needed.
 */

import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertSupported } from './platform'
import type { HelperResult, SEAvailability, VaultConfig } from './types'

const __dirname = dirname(fileURLToPath(import.meta.url))

let config: Required<VaultConfig> = {
	name: '@1sat/vault',
}

/**
 * Configure the vault before use.
 *
 * ```ts
 * import { configureVault } from '@1sat/vault'
 * configureVault({ name: 'clawnet' })
 * ```
 */
export function configureVault(userConfig: VaultConfig): void {
	if (userConfig.name) config.name = userConfig.name
}

/** @internal Get the configured display name for error messages. */
export function getVaultName(): string {
	return config.name
}

function getHelperPath(): string {
	// Works from both src/ (dev) and dist/ (published):
	// dist/enclave.js → ../swift/se-helper
	// src/enclave.ts → ../swift/se-helper
	return resolve(__dirname, '../swift/se-helper')
}

async function callHelper(
	args: string[],
	stdin?: string,
): Promise<HelperResult> {
	assertSupported()

	const helperPath = getHelperPath()
	if (!existsSync(helperPath)) {
		// Auto-compile if binary missing (bun can skip postinstall for cached packages)
		const buildScript = resolve(__dirname, '../swift/build.sh')
		if (!existsSync(buildScript)) {
			throw new Error(
				`${config.name}: Secure Enclave helper not found. Run: cd node_modules/@1sat/vault && ./swift/build.sh`,
			)
		}
		const build = Bun.spawnSync(['sh', buildScript], {
			cwd: resolve(__dirname, '..'),
			stdout: 'pipe',
			stderr: 'pipe',
		})
		if (build.exitCode !== 0 || !existsSync(helperPath)) {
			const err = new TextDecoder().decode(build.stderr)
			throw new Error(`${config.name}: Failed to compile Secure Enclave helper. ${err}`)
		}
	}

	const proc = Bun.spawn([helperPath, ...args], {
		stdout: 'pipe',
		stderr: 'pipe',
		stdin: stdin ? new Response(stdin) : undefined,
	})

	const stdout = await new Response(proc.stdout).text()
	const stderr = await new Response(proc.stderr).text()
	await proc.exited

	if (!stdout.trim()) {
		const hint = stderr ? ` stderr: ${stderr.trim()}` : ''
		throw new Error(
			`${config.name}: Secure Enclave helper produced no output.${hint} Is it compiled? Run: ./swift/build.sh`,
		)
	}

	const result: HelperResult = JSON.parse(stdout.trim())
	if (!result.success) {
		throw new Error(result.error ?? 'Unknown Secure Enclave error')
	}
	return result
}

/** Check Secure Enclave and biometric availability */
export async function checkAvailability(): Promise<SEAvailability> {
	const r = await callHelper(['check'])
	return {
		secureEnclave: r.meta?.secureEnclave === 'true',
		biometryType: r.meta?.biometryType ?? 'Unknown',
		biometryAvailable: r.meta?.biometryAvailable === 'true',
		vaultDir: r.meta?.vaultDir ?? '',
	}
}

/** Generate a P-256 key pair in the Secure Enclave. Returns the public key hex. */
export async function generateKey(label: string): Promise<{
	publicKey: string
	keyFile: string
}> {
	const r = await callHelper(['generate', label])
	if (!r.data)
		throw new Error(`${config.name}: Secure Enclave returned no data for generate`)
	return {
		publicKey: r.data,
		keyFile: r.meta?.keyFile ?? '',
	}
}

/**
 * Encrypt plaintext using the SE public key (ECIES).
 * NO Touch ID required — only the public key is used.
 * Plaintext is piped via stdin (not visible in process list).
 */
export async function encrypt(
	label: string,
	plaintext: string,
): Promise<string> {
	const r = await callHelper(['encrypt', label], plaintext)
	if (!r.data)
		throw new Error(`${config.name}: Secure Enclave returned no data for encrypt`)
	return r.data
}

/**
 * Decrypt ciphertext using the SE private key.
 * TRIGGERS Touch ID — the ECDH happens inside the Secure Enclave chip.
 */
export async function decrypt(
	label: string,
	ciphertext: string,
): Promise<string> {
	const r = await callHelper(['decrypt', label, ciphertext, config.name])
	if (!r.data)
		throw new Error(`${config.name}: Secure Enclave returned no data for decrypt`)
	return r.data
}

/** Delete a Secure Enclave key and its files */
export async function deleteKey(label: string): Promise<void> {
	await callHelper(['delete', label])
}

/** List all SE keys managed by this vault */
export async function listKeys(): Promise<
	Array<{ label: string; publicKey: string }>
> {
	const r = await callHelper(['list'])
	if (!r.data || r.data === '[]') return []
	return JSON.parse(r.data)
}
