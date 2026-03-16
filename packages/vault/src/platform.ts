import { arch, platform } from 'node:os'

/** Check if the current platform supports Secure Enclave */
export function isSupported(): boolean {
	return platform() === 'darwin' && arch() === 'arm64'
}

/** Throw with a clear message if Secure Enclave is not supported */
export function assertSupported(): void {
	const p = platform()
	const a = arch()

	if (p !== 'darwin') {
		throw new Error(
			`@1sat/vault requires macOS (current: ${p}). Secure Enclave is only available on Apple hardware.`,
		)
	}
	if (a !== 'arm64') {
		throw new Error(
			`@1sat/vault requires Apple Silicon arm64 (current: ${a}). Intel Macs are not supported.`,
		)
	}
}
