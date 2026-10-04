/**
 * BRC-169 envelope, DAG-CBOR encoding (§7.2, §7.3).
 *
 * The signature is made by the key derived from `sender.identityKey` under
 * protocol `[2, 'metanet handles envelope']`, key ID `send`, counterparty
 * `anyone`, over SHA-256 of the DAG-CBOR map with `content` and `signature`
 * removed. A verifier derives the same public key from `sender.identityKey`.
 */

import {
	ProtoWallet,
	Utils,
	type WalletInterface,
	type WalletProtocol,
} from '@bsv/sdk'
import {
	decode as dagCborDecode,
	encode as dagCborEncode,
} from '@ipld/dag-cbor'

/** §7.2 item 3 signing protocol */
export const ENVELOPE_SIGNATURE_PROTOCOL: WalletProtocol = [
	2,
	'metanet handles envelope',
]
/** §7.2 item 3 signing key ID */
export const ENVELOPE_SIGNATURE_KEY_ID = 'send'

/** §7.3 `payment` member */
export interface EnvelopePayment {
	derivationPrefix: Uint8Array
	derivationSuffix: Uint8Array
	/** UTF-8 bytes of the BRC-43 protocol name */
	protocol: Uint8Array
	satoshis: number
	/** Atomic BEEF */
	beef: Uint8Array
}

/** The §7.3 envelope without `content` and `signature`: the signing preimage map. */
export interface UnsignedEnvelope {
	metanetHandles: string
	recipient: { handle: string; tag?: string; domain: string }
	/** `identityKey` is the 33-byte compressed key */
	sender: { identityKey: Uint8Array; handle?: string; domain?: string }
	/** ISO-8601 UTC timestamp */
	created: string
	quoteId?: string
	payment: EnvelopePayment | null
	contentHash?: Uint8Array
}

/** Drop undefined members: DAG-CBOR has no `undefined`. */
function defined<T extends object>(obj: T): T {
	return Object.fromEntries(
		Object.entries(obj).filter(([, v]) => v !== undefined),
	) as T
}

function envelopeMap(env: UnsignedEnvelope): Record<string, unknown> {
	return defined({
		...env,
		recipient: defined(env.recipient),
		sender: defined(env.sender),
	})
}

/** DAG-CBOR bytes of the envelope with `content` and `signature` removed. */
export function envelopeSigningPreimage(env: UnsignedEnvelope): Uint8Array {
	return dagCborEncode(envelopeMap(env))
}

/**
 * Sign an envelope with the wallet's identity (§7.2 item 3) and return the
 * full DAG-CBOR envelope, `content` and `signature` included.
 *
 * @param content - the encrypted content bytes (§7.3 `content`)
 */
export async function signEnvelope(
	wallet: Pick<WalletInterface, 'createSignature'>,
	env: UnsignedEnvelope,
	content: Uint8Array,
): Promise<{ envelope: Uint8Array; signature: Uint8Array }> {
	const { signature } = await wallet.createSignature({
		data: Array.from(envelopeSigningPreimage(env)),
		protocolID: ENVELOPE_SIGNATURE_PROTOCOL,
		keyID: ENVELOPE_SIGNATURE_KEY_ID,
		counterparty: 'anyone',
	})
	const sig = Uint8Array.from(signature)
	return {
		envelope: dagCborEncode({ ...envelopeMap(env), content, signature: sig }),
		signature: sig,
	}
}

/** A received §7.3 envelope: the signed members plus `content` and `signature`. */
export interface ReceivedEnvelope extends UnsignedEnvelope {
	content: Uint8Array
	signature: Uint8Array
}

/** Decode a §7.3 DAG-CBOR envelope. */
export function decodeEnvelope(bytes: Uint8Array): ReceivedEnvelope {
	const env = dagCborDecode(bytes) as ReceivedEnvelope
	if (
		!env ||
		typeof env !== 'object' ||
		!(env.sender?.identityKey instanceof Uint8Array) ||
		!(env.content instanceof Uint8Array) ||
		!(env.signature instanceof Uint8Array)
	) {
		throw new Error('not a BRC-169 DAG-CBOR envelope')
	}
	return env
}

/**
 * Verify an envelope's §7.2 item 3 signature: the key derived from
 * `sender.identityKey` under the signing protocol, key ID `send`,
 * counterparty `anyone`, over the map without `content` and `signature`.
 */
export async function verifyEnvelope(env: ReceivedEnvelope): Promise<boolean> {
	const { content: _c, signature, ...unsigned } = env
	try {
		const { valid } = await new ProtoWallet('anyone').verifySignature({
			data: Array.from(envelopeSigningPreimage(unsigned)),
			signature: Array.from(signature),
			protocolID: ENVELOPE_SIGNATURE_PROTOCOL,
			keyID: ENVELOPE_SIGNATURE_KEY_ID,
			counterparty: Utils.toHex(Array.from(env.sender.identityKey)),
		})
		return valid
	} catch {
		// ProtoWallet throws on an invalid signature.
		return false
	}
}
