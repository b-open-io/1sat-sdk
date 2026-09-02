/**
 * Single codec for WPM `encryptWalletMetadata` customInstructions.
 *
 * Contract for the actions layer:
 * - Storage may hold base64 ciphertext (base wallet list) or plaintext JSON
 *   (after WPM list decrypt, or encrypt off).
 * - Every read path normalizes to plaintext JSON via {@link ensurePlaintextCi}.
 * - Write paths hand plaintext to WPM createAction/internalize (WPM encrypts),
 *   except module onRequest which runs *after* WPM encrypt and must
 *   re-encrypt via {@link encryptWalletMetadataCi} when it mutates CI.
 */

import { Utils, type WalletInterface } from '@bsv/sdk'

/** Same protocol WPM uses for description/CI encryption. */
export const METADATA_ENCRYPTION_PROTOCOL: [2, string] = [
	2,
	'admin metadata encryption',
]

const MAX_PEEL = 3

export function looksLikeJson(value: string): boolean {
	try {
		JSON.parse(value)
		return true
	} catch {
		return false
	}
}

async function tryDecryptOnce(
	wallet: WalletInterface,
	value: string,
): Promise<string | undefined> {
	try {
		const { plaintext } = await wallet.decrypt({
			ciphertext: Utils.toArray(value, 'base64'),
			protocolID: METADATA_ENCRYPTION_PROTOCOL,
			keyID: '1',
			counterparty: 'self',
		})
		return Utils.toUTF8(plaintext)
	} catch {
		return undefined
	}
}

/**
 * Normalize CI to plaintext JSON when possible.
 * Peels WPM layers (including legacy double-encrypt) until JSON or give up.
 */
export async function ensurePlaintextCi(
	wallet: WalletInterface,
	value: string | undefined,
): Promise<string | undefined> {
	if (value == null || value === '') return undefined
	let cur = value
	for (let i = 0; i < MAX_PEEL; i++) {
		if (looksLikeJson(cur)) return cur
		const next = await tryDecryptOnce(wallet, cur)
		if (next == null || next === cur) return cur
		cur = next
	}
	return cur
}

/** Encrypt plaintext CI the way WPM does at rest. */
export async function encryptWalletMetadataCi(
	wallet: WalletInterface,
	plaintext: string,
): Promise<string> {
	const { ciphertext } = await wallet.encrypt({
		plaintext: Utils.toArray(plaintext, 'utf8'),
		protocolID: METADATA_ENCRYPTION_PROTOCOL,
		keyID: '1',
		counterparty: 'self',
	})
	return Utils.toBase64(ciphertext)
}
