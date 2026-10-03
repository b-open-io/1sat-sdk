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
