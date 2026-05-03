/**
 * buildCosignDestination — derive a cosign-wrapped lockingScript for a
 * recipient, using the caller's wallet as the BRC-42 partner.
 *
 * Resulting script pattern:
 *   OP_DUP OP_HASH160 <derivedAddrHash> OP_EQUALVERIFY OP_CHECKSIGVERIFY
 *   <cosignerIdentityKey> OP_CHECKSIG
 *
 * Spending later requires both the recipient's signature (over the derived key)
 * and the cosigner's signature.
 *
 * The caller passes `cosignerIdentityKey` in — this helper does not look up any
 * cosigner config endpoint. That keeps the action reusable across cosigner
 * backends.
 */

import { Cosign } from '@1sat/templates'
import { type LockingScript, PublicKey } from '@bsv/sdk'
import type { OneSatContext } from '../types'
import { COSIGN_PROTOCOL_ID } from './types'

export interface BuildCosignDestinationInput {
	/** Recipient's identity public key (hex). */
	recipientIdentityKey: string
	/** Cosigner's identity public key (hex). Embedded in the script as second-signer. */
	cosignerIdentityKey: string
	/** keyID used for the BRC-42 derivation between caller and recipient. */
	keyID: string
}

export interface BuildCosignDestinationResult {
	lockingScript: LockingScript
	address: string
}

export async function buildCosignDestination(
	ctx: OneSatContext,
	input: BuildCosignDestinationInput,
): Promise<BuildCosignDestinationResult> {
	const { publicKey: recipientDerivedPub } = await ctx.wallet.getPublicKey({
		protocolID: COSIGN_PROTOCOL_ID,
		keyID: input.keyID,
		counterparty: input.recipientIdentityKey,
		forSelf: false,
	})
	const address = PublicKey.fromString(recipientDerivedPub).toAddress()
	const lockingScript = Cosign.lock(address, input.cosignerIdentityKey)
	return { lockingScript, address }
}
