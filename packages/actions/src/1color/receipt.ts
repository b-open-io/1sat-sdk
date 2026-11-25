/**
 * BRC-207 receipt instructions: the `customInstructions` of a `basket
 * insertion` into `p color <assetTag>` (or `… authority`), as BRC-232
 * carries them and `internalizeAction` takes them.
 *
 * The string is exactly the JSON `{"version":1,"assetId":"<txid>_<vout>",
 * "derivationPrefix":…,"derivationSuffix":…,"senderIdentityKey":"<66 hex>"}`
 * with these members in this order and nothing else.
 */

import { OneColor } from '@1sat/templates'
import {
	ISSUE,
	type TokenRole,
	assetBasket,
	colorProtocolID,
	parseAssetBasket,
} from '@bsv/color-permission-module'
import type { Transaction } from '@bsv/sdk'

/** Receipt facts for one received 1Color output. */
export interface ColorReceipt {
	/** Canonical asset id `<txid>_<vout>` */
	assetId: string
	derivationPrefix: string
	derivationSuffix: string
	/** Compressed public key, 66 lowercase hex */
	senderIdentityKey: string
}

const IDENTITY_KEY = /^0[23][0-9a-f]{64}$/

/** The exact receipt JSON string for `receipt`. */
export function colorReceiptInstructions(receipt: ColorReceipt): string {
	return JSON.stringify({
		version: 1,
		assetId: receipt.assetId,
		derivationPrefix: receipt.derivationPrefix,
		derivationSuffix: receipt.derivationSuffix,
		senderIdentityKey: receipt.senderIdentityKey,
	})
}

/**
 * Parse receipt instructions, accepting only the exact string
 * {@link colorReceiptInstructions} produces (so no other members, no
 * duplicate members, no whitespace, no `ISSUE`).
 */
export function parseColorReceipt(customInstructions: string): ColorReceipt {
	let parsed: unknown
	try {
		parsed = JSON.parse(customInstructions)
	} catch {
		throw new Error('BRC-207: receipt customInstructions are not JSON')
	}
	const r = parsed as Record<string, unknown>
	if (
		r === null ||
		typeof r !== 'object' ||
		Array.isArray(r) ||
		r.version !== 1 ||
		typeof r.assetId !== 'string' ||
		r.assetId === ISSUE ||
		typeof r.derivationPrefix !== 'string' ||
		typeof r.derivationSuffix !== 'string' ||
		typeof r.senderIdentityKey !== 'string' ||
		!IDENTITY_KEY.test(r.senderIdentityKey)
	) {
		throw new Error('BRC-207: malformed receipt customInstructions')
	}
	const receipt: ColorReceipt = {
		assetId: r.assetId,
		derivationPrefix: r.derivationPrefix,
		derivationSuffix: r.derivationSuffix,
		senderIdentityKey: r.senderIdentityKey,
	}
	// Validates the asset id and the remittance strings.
	colorProtocolID(
		receipt.assetId,
		receipt.derivationPrefix,
		receipt.derivationSuffix,
	)
	if (colorReceiptInstructions(receipt) !== customInstructions) {
		throw new Error(
			'BRC-207: receipt customInstructions must be exactly {version, assetId, derivationPrefix, derivationSuffix, senderIdentityKey}',
		)
	}
	return receipt
}

/**
 * Check one received `basket insertion` into a `p color` basket against the
 * subject transaction: the basket names the receipt's asset and the output's
 * role, and the output is a 1Color output of that asset. Returns the asset
 * and role; the wallet's module performs the ownership and admission checks.
 */
export function checkColorReceipt(
	subject: Transaction,
	outputIndex: number,
	basket: string,
	customInstructions: string,
): { assetId: string; role: TokenRole } {
	const target = parseAssetBasket(basket)
	if (!target) {
		throw new Error(`BRC-207: ${basket} is not a per-asset p color basket`)
	}
	const receipt = parseColorReceipt(customInstructions)
	if (receipt.assetId !== target.assetId) {
		throw new Error(
			`BRC-207: the receipt names ${receipt.assetId}, the basket ${target.assetId}`,
		)
	}
	if (assetBasket(target.assetId, target.role) !== basket) {
		throw new Error(`BRC-207: ${basket} is not a canonical basket name`)
	}
	const script = subject.outputs[outputIndex]?.lockingScript
	const token = script ? OneColor.decode(script) : null
	const role = token?.role === 'authority' ? 'authority' : 'value'
	if (
		!token ||
		token.role === 'deploy' ||
		token.tokenId !== target.assetId ||
		role !== target.role
	) {
		throw new Error(
			`output ${outputIndex}: not a 1Color ${target.role} output of ${target.assetId}`,
		)
	}
	return target
}
