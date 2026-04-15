import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { VaultAvailability, VaultProvider } from '@1sat/vault'
import { isMacOS } from './platform'

const __dirname = dirname(fileURLToPath(import.meta.url))

interface EnclaveResult {
	success: boolean
	data?: string
	error?: string
	meta?: Record<string, string>
}

export class SecureEnclaveProvider implements VaultProvider {
	readonly platform = 'darwin-arm64'
	private readonly displayName: string

	constructor(opts?: { name?: string }) {
		this.displayName = opts?.name ?? '@1sat/wallet-mac'
	}

	isSupported(): boolean {
		return isMacOS()
	}

	async checkAvailability(): Promise<VaultAvailability> {
		const result = await this.callEnclave(['check'])
		return {
			supported: result.meta?.secureEnclave === 'true',
			biometryType:
				(result.meta?.biometryType as VaultAvailability['biometryType']) ??
				'None',
			biometryAvailable: result.meta?.biometryAvailable === 'true',
		}
	}

	async generateKey(label: string): Promise<{ publicKey: string }> {
		const result = await this.callEnclave(['generate', label])
		return { publicKey: result.data! }
	}

	async encrypt(label: string, plaintext: string): Promise<string> {
		const result = await this.callEnclave(['encrypt', label], plaintext)
		return result.data!
	}

	async decrypt(label: string, ciphertext: string): Promise<string> {
		const result = await this.callEnclave([
			'decrypt',
			label,
			ciphertext,
			this.displayName,
		])
		return result.data!
	}

	async deleteKey(label: string): Promise<void> {
		await this.callEnclave(['delete', label])
	}

	async listKeys(): Promise<Array<{ label: string; publicKey: string }>> {
		const result = await this.callEnclave(['list'])
		if (!result.data || result.data === '[]') return []
		return JSON.parse(result.data)
	}

	private getEnclavePath(): string {
		const candidates = [
			// Signed/stable build: postBuild copies enclave to MacOS/
			resolve(process.argv0, '..', 'enclave'),
			// Dev build: enclave binary in the source tree
			// process.cwd() in Electrobun dev is the wallet-desktop package root
			resolve(process.cwd(), '..', 'wallet-mac', 'swift', 'enclave'),
		]

		for (const path of candidates) {
			if (existsSync(path)) return path
		}

		throw new Error(
			`Secure Enclave binary not found. Checked:\n${candidates.map((p) => `  ${p}`).join('\n')}\n` +
				'Compile with: cd packages/wallet-mac/swift && sh build.sh',
		)
	}

	private async callEnclave(
		args: string[],
		stdin?: string,
	): Promise<EnclaveResult> {
		const enclavePath = this.getEnclavePath()

		// Auto-compile if binary is missing
		if (!existsSync(enclavePath)) {
			const buildScript = resolve(__dirname, '../swift/build.sh')
			const buildProc = Bun.spawnSync(['sh', buildScript], {
				cwd: resolve(__dirname, '../swift'),
				stdout: 'pipe',
				stderr: 'pipe',
			})
			if (buildProc.exitCode !== 0) {
				const stderr = buildProc.stderr.toString()
				throw new Error(`Failed to compile Secure Enclave binary: ${stderr}`)
			}
			if (!existsSync(enclavePath)) {
				throw new Error(
					'Secure Enclave binary not found after build. Ensure you are on macOS arm64 with Xcode Command Line Tools installed.',
				)
			}
		}

		const proc = Bun.spawn([enclavePath, ...args], {
			stdin: stdin != null ? new Blob([stdin]).stream() : undefined,
			stdout: 'pipe',
			stderr: 'pipe',
		})

		const stdout = await new Response(proc.stdout).text()
		const stderr = await new Response(proc.stderr).text()
		const exitCode = await proc.exited

		if (!stdout.trim()) {
			throw new Error(
				`Enclave binary returned no output (exit ${exitCode}): ${stderr}`,
			)
		}

		let result: EnclaveResult
		try {
			result = JSON.parse(stdout.trim())
		} catch {
			throw new Error(`Failed to parse enclave output: ${stdout.trim()}`)
		}

		if (!result.success) {
			throw new Error(result.error ?? 'Unknown enclave error')
		}

		return result
	}
}
