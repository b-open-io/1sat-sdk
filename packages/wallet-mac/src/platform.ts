import { arch, platform } from 'node:os'

export function isMacOS(): boolean {
	return platform() === 'darwin' && arch() === 'arm64'
}

export function assertMacOS(): void {
	const p = platform()
	const a = arch()
	if (p !== 'darwin') {
		throw new Error(`@1sat/wallet-mac requires macOS (current: ${p}).`)
	}
	if (a !== 'arm64') {
		throw new Error(
			`@1sat/wallet-mac requires Apple Silicon arm64 (current: ${a}).`,
		)
	}
}
