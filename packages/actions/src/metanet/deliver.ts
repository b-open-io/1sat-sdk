/**
 * Send a signed BRC-169 §7.3 envelope (DAG-CBOR, BRC-231 body over BRC-104)
 * to a resolved handle's messagebox.
 *
 * `content` is BRC-78 encryption (via `wallet.encrypt`) of the given MIME
 * plaintext to the recipient's identity key; `contentHash` is the SHA-256 of
 * that plaintext; the signature is per §7.2 item 3.
 */

import type { HandleResolution } from '@1sat/client'
import { Hash, Utils, type WalletInterface } from '@bsv/sdk'
import { encryptBrc78 } from './brc78.js'
import { type EnvelopePayment, signEnvelope } from './envelope.js'
import { messageRelay } from './relay.js'

/** A fresh random 16-byte value, base64: a BRC-29 derivation prefix/suffix or key ID half. */
export function randomBase64(): string {
	return Utils.toBase64(Array.from(crypto.getRandomValues(new Uint8Array(16))))
}

export async function sendEnvelope(
	wallet: WalletInterface,
	resolution: HandleResolution,
	p: {
		/** Our identity key, hex */
		senderIdentityKey: string
		/** The MIME entity `content` encrypts */
		plaintext: number[]
		payment: EnvelopePayment | null
		/** Messagebox box name */
		messageBox: string
	},
): Promise<{ status: string; messageId: string }> {
	const content = await encryptBrc78(
		wallet,
		p.plaintext,
		resolution.identityKey,
	)
	const bytes = (a: number[]) => Uint8Array.from(a)
	const { envelope } = await signEnvelope(
		wallet,
		{
			metanetHandles: '1.0',
			recipient: {
				handle: resolution.handle,
				tag: resolution.tag,
				domain: resolution.domain,
			},
			sender: { identityKey: bytes(Utils.toArray(p.senderIdentityKey, 'hex')) },
			created: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
			payment: p.payment,
			contentHash: bytes(Hash.sha256(p.plaintext)),
		},
		bytes(content),
	)
	return messageRelay.sendCborMessage(
		wallet,
		resolution.messagebox,
		resolution.identityKey,
		p.messageBox,
		envelope,
	)
}
