/**
 * Send-dialog recipient routing: a Base58 address is sent as `address`;
 * `@handle@domain` or `handle@domain` (a `+tag` rides on the handle) is sent
 * as `handle`, which `sendBsv` resolves as BRC-169 (bare `handle@domain`
 * falls back to paymail when the domain offers no handles).
 */

import { Utils } from '@bsv/sdk'

/** Validate a BSV address by decoding Base58Check and verifying the checksum. */
export function isValidBsvAddress(address: string): boolean {
	try {
		const { prefix } = Utils.fromBase58Check(address)
		// Mainnet P2PKH = 0x00, P2SH = 0x05
		const byte = Array.isArray(prefix)
			? prefix[0]
			: (prefix as unknown as number)
		return byte === 0x00 || byte === 0x05
	} catch {
		return false
	}
}

/** BRC-169 `@handle@domain`, or `handle@domain` (BRC-169 first, else paymail); `+tag` rides on the handle */
const HANDLE_RE = /^@?[^\s@]+@[^\s@]+\.[^\s@]+$/

export function isValidRecipient(value: string): boolean {
	const trimmed = value.trim()
	return isValidBsvAddress(trimmed) || HANDLE_RE.test(trimmed)
}

/** Route a valid recipient: a Base58 address, otherwise a handle. */
export function sendTarget(
	value: string,
): { address: string } | { handle: string } {
	const trimmed = value.trim()
	return isValidBsvAddress(trimmed) ? { address: trimmed } : { handle: trimmed }
}
