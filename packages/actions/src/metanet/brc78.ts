/**
 * BRC-78 portable encrypted message, with the crypto done by the wallet.
 *
 * BRC-78 is BRC-2 encryption under protocol `[2, 'message encryption']` with a
 * random 32-byte key ID (base64 in the invoice number) and counterparty = the
 * recipient: exactly BRC-100 `wallet.encrypt`. This module only writes the
 * BRC-78 framing around the wallet's ciphertext, in the byte layout of
 * `@bsv/sdk`'s `EncryptedMessage` (so its `decrypt` reads it):
 *
 *   version `42421033` (4) ‖ sender identity key (33) ‖ recipient identity
 *   key (33) ‖ key ID (32) ‖ AES-256-GCM ciphertext (IV prepended)
 */

import { Utils, type WalletInterface, type WalletProtocol } from '@bsv/sdk'

/** BRC-78 protocol, security level 2 */
export const BRC78_PROTOCOL: WalletProtocol = [2, 'message encryption']
/** Version bytes, in `@bsv/sdk` `EncryptedMessage` order */
export const BRC78_VERSION = '42421033'

/**
 * Encrypt `plaintext` to `recipient` (identity key hex) and return the BRC-78
 * serialization.
 */
export async function encryptBrc78(
	wallet: Pick<WalletInterface, 'encrypt' | 'getPublicKey'>,
	plaintext: number[],
	recipient: string,
): Promise<number[]> {
	const keyID = Array.from(crypto.getRandomValues(new Uint8Array(32)))
	const { ciphertext } = await wallet.encrypt({
		plaintext,
		protocolID: BRC78_PROTOCOL,
		keyID: Utils.toBase64(keyID),
		counterparty: recipient,
	})
	const { publicKey: sender } = await wallet.getPublicKey({
		identityKey: true,
	})
	return [
		...Utils.toArray(BRC78_VERSION, 'hex'),
		...Utils.toArray(sender, 'hex'),
		...Utils.toArray(recipient, 'hex'),
		...keyID,
		...ciphertext,
	]
}

/**
 * Decrypt a BRC-78 serialization addressed to this wallet: the inverse of
 * {@link encryptBrc78}. The key ID is read from the BRC-78 header; the
 * counterparty is the sender's identity key.
 */
export async function decryptBrc78(
	wallet: Pick<WalletInterface, 'decrypt'>,
	message: number[] | Uint8Array,
	sender: string,
): Promise<number[]> {
	const bytes = Array.from(message)
	if (Utils.toHex(bytes.slice(0, 4)) !== BRC78_VERSION) {
		throw new Error('BRC-78: unsupported version')
	}
	const keyID = bytes.slice(4 + 33 + 33, 4 + 33 + 33 + 32)
	const { plaintext } = await wallet.decrypt({
		ciphertext: bytes.slice(4 + 33 + 33 + 32),
		protocolID: BRC78_PROTOCOL,
		keyID: Utils.toBase64(keyID),
		counterparty: sender,
	})
	return plaintext
}
