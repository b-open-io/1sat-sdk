/**
 * BRC-77 request signing using WalletInterface.
 *
 * Produces a proper BRC-77 message envelope (version + sender pubkey +
 * recipient indicator + keyID + DER signature) that go-bitcoin-auth and
 * @bsv/sdk SignedMessage.verify can both verify.
 */

import type { WalletInterface } from '@bsv/sdk'
import { Hash, Random, Utils } from '@bsv/sdk'

const { toArray, toBase64, toHex } = Utils

const BRC77_VERSION = [0x42, 0x42, 0x33, 0x01]
const BRC77_PROTOCOL_ID: [0 | 1 | 2, string] = [2, 'message signing']

/**
 * Sign an HTTP request with BRC-77 auth, returning the auth token string.
 *
 * The token format is: `pubkey|brc77|timestamp|requestPath|signature`
 * where signature is a base64-encoded BRC-77 message envelope.
 *
 * @param wallet - Any BRC-100 WalletInterface (Sigma CWI, OneSat, extension, etc.)
 * @param requestPath - API endpoint path including query params
 * @param body - Optional request body to include in signature
 */
export async function signRequest(
	wallet: WalletInterface,
	requestPath: string,
	body?: string,
): Promise<string> {
	const timestamp = new Date().toISOString()
	const bodyHash = body ? toHex(Hash.sha256(toArray(body, 'utf8'))) : ''
	const message = `${requestPath}|${timestamp}|${bodyHash}`
	const messageBytes = toArray(message, 'utf8')

	// Random 32-byte keyID — matches BRC-77 SignedMessage.sign behavior
	const keyID = Random(32)
	const keyIDBase64 = toBase64(keyID)

	// Get the sender's identity public key (root, not derived)
	const { publicKey: senderPubKeyHex } = await wallet.getPublicKey({
		identityKey: true,
	})

	// Sign with BRC-42 derivation matching BRC-77:
	// invoice = "2-message signing-{keyIDBase64}"
	// counterparty = "anyone" (pubkey for private key = 1)
	const { signature: derSig } = await wallet.createSignature({
		protocolID: BRC77_PROTOCOL_ID,
		keyID: keyIDBase64,
		counterparty: 'anyone',
		data: Array.from(messageBytes),
	})

	// Build BRC-77 envelope:
	// [4 bytes version][33 bytes sender pubkey][1 byte 0x00 = anyone][32 bytes keyID][DER signature]
	const senderPubKeyBytes = toArray(senderPubKeyHex, 'hex')
	const envelope = [
		...BRC77_VERSION,
		...senderPubKeyBytes,
		0x00, // anyone can verify
		...keyID,
		...derSig,
	]

	const signatureBase64 = toBase64(envelope)
	return `${senderPubKeyHex}|brc77|${timestamp}|${requestPath}|${signatureBase64}`
}
