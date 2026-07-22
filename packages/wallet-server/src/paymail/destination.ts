/**
 * BRC-29 payment destination for a bound identity (anyone-deriver path).
 * Port of Go DerivePaymentDestination.
 */

import { BRC29_PROTOCOL_ID } from '@1sat/types'
import { KeyDeriver, P2PKH, PrivateKey, PublicKey, Utils } from '@bsv/sdk'
import { DEFAULT_TTL_MS, generateReference } from './pending'
import type { PendingPayment, PendingStore } from './types'

function randomB64(n: number): string {
	const b = new Uint8Array(n)
	crypto.getRandomValues(b)
	return Utils.toBase64(Array.from(b))
}

export async function createPaymentDestination(
	store: PendingStore,
	opts: {
		alias: string
		domain: string
		identityPubKey: string
		satoshis: number
		ttlMs?: number
	},
): Promise<PendingPayment> {
	const derivationPrefix = randomB64(16)
	const derivationSuffix = randomB64(16)
	const keyID = `${derivationPrefix} ${derivationSuffix}`

	// Anyone-key derives the payment pub the recipient can spend (BRC-29).
	const anyone = new KeyDeriver(new PrivateKey(1))
	const paymentPub = anyone.derivePublicKey(
		BRC29_PROTOCOL_ID,
		keyID,
		PublicKey.fromString(opts.identityPubKey),
		false,
	)
	const outputScript = new P2PKH().lock(paymentPub.toAddress()).toHex()

	const now = new Date()
	const ttl = opts.ttlMs ?? DEFAULT_TTL_MS
	const pending: PendingPayment = {
		reference: generateReference(),
		alias: opts.alias,
		domain: opts.domain,
		identityPubKey: opts.identityPubKey,
		derivationPrefix,
		derivationSuffix,
		satoshis: opts.satoshis,
		outputScript,
		createdAt: now,
		expiresAt: new Date(now.getTime() + ttl),
	}
	await store.create(pending)
	return pending
}

export function verifyPaymentOutputs(
	outputScriptsHex: string[],
	satoshis: number[],
	pending: PendingPayment,
): number {
	for (let i = 0; i < outputScriptsHex.length; i++) {
		if (outputScriptsHex[i] !== pending.outputScript) continue
		if (pending.satoshis === 0 || satoshis[i] === pending.satoshis) {
			return i
		}
	}
	throw new Error('no output matches the expected payment destination')
}
