/**
 * The BRC-207 custody of a 1Color output: the `p color` derivation that locks
 * it, and the same triple a BRC-232 receipt carries so that its recipient can
 * derive the identical key.
 *
 * Every 1Color output is locked to a key derived under
 * `colorProtocolID(assetId, prefix, suffix)` with keyID `color`, counterparty
 * the sender's identity key, and a fresh random 16-byte prefix and suffix per
 * output. Who holds the output decides the counterparty only:
 *
 * - an output this wallet keeps: counterparty `self` (its own identity key),
 *   and the custody goes in `plan.ownedOutputs` so the module files it in the
 *   asset's basket;
 * - an output to a counterparty: their identity key, and the custody goes in
 *   the receipt, which is how they recognize the output.
 *
 * The wallet's own deploy output is the one output these builders do not derive
 * a key for: the module files it under `colorProtocolID(ISSUE, …)`, since its
 * outpoint is only the asset id after it is signed. That is
 * {@link deploy1Color}'s business; here a deploy output is only ever spent.
 */

import { type HandleResolution, resolveHandle } from '@1sat/client'
import {
	COLOR_KEY_ID,
	type ColorRemittance,
	colorProtocolID,
} from '@bsv/color-permission-module'
import { PublicKey } from '@bsv/sdk'
import { randomBase64 } from '../metanet/deliver.js'
import type { OneSatContext } from '../types.js'

/** The derivation of one 1Color output, as the module and a receipt both name it. */
export interface ColorCustody {
	/** The asset the output belongs to, `<txid>_<vout>` */
	assetId: string
	derivationPrefix: string
	derivationSuffix: string
	/** The sender's identity key, 66 lowercase hex */
	senderIdentityKey: string
}

/** A fresh custody for an output of `assetId`, with this wallet's identity key. */
export async function newColorCustody(
	ctx: OneSatContext,
	assetId: string,
): Promise<ColorCustody> {
	const { publicKey: senderIdentityKey } = await ctx.wallet.getPublicKey({
		identityKey: true,
	})
	return {
		assetId,
		derivationPrefix: randomBase64(),
		derivationSuffix: randomBase64(),
		senderIdentityKey,
	}
}

/** The P2PKH hash (20 bytes) of a custody's key, held by this wallet. */
export async function selfColorLock(
	ctx: OneSatContext,
	custody: ColorCustody,
): Promise<number[]> {
	const { publicKey } = await ctx.wallet.getPublicKey({
		protocolID: colorProtocolID(
			custody.assetId,
			custody.derivationPrefix,
			custody.derivationSuffix,
		),
		keyID: COLOR_KEY_ID,
		counterparty: 'self',
		forSelf: true,
	})
	return PublicKey.fromString(publicKey).toHash() as number[]
}

/**
 * The P2PKH hash (20 bytes) of a custody's key as its recipient derives it:
 * the same point, from their side of the exchange, so the recipient needs
 * nothing but the receipt to spend the output.
 */
export async function recipientColorLock(
	ctx: OneSatContext,
	custody: ColorCustody,
	recipientIdentityKey: string,
): Promise<number[]> {
	const { publicKey } = await ctx.wallet.getPublicKey({
		protocolID: colorProtocolID(
			custody.assetId,
			custody.derivationPrefix,
			custody.derivationSuffix,
		),
		keyID: COLOR_KEY_ID,
		counterparty: recipientIdentityKey,
	})
	return PublicKey.fromString(publicKey).toHash() as number[]
}

/**
 * Resolve a BRC-169 handle and lock one custody's output to its holder: the
 * recipient key, the resolution to deliver to, and the canonical
 * `@handle+tag@domain` the resolution settled on, for the action's description.
 */
export async function resolveColorRecipient(
	ctx: OneSatContext,
	custody: ColorCustody,
	handle: string,
): Promise<{
	lock: number[]
	resolution: HandleResolution
	handle: string
}> {
	const resolution = await resolveHandle(handle)
	const lock = await recipientColorLock(ctx, custody, resolution.identityKey)
	return {
		lock,
		resolution,
		handle: `@${resolution.handle}${resolution.tag ? `+${resolution.tag}` : ''}@${resolution.domain}`,
	}
}

/** The plan remittance for an output this wallet keeps under `custody`. */
export function colorRemittance(
	outputIndex: number,
	custody: ColorCustody,
): ColorRemittance {
	return {
		outputIndex,
		assetId: custody.assetId,
		derivationPrefix: custody.derivationPrefix,
		derivationSuffix: custody.derivationSuffix,
		senderIdentityKey: custody.senderIdentityKey,
	}
}
