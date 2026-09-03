/**
 * Authoritative ordinal/OpNS CI stamp — shared by local apply and module.
 *
 * For basketed outs with CI on `1sat` / `opns`:
 * - Start from caller CI (keep derivation)
 * - Overwrite origin/content/app/collection/name from output tags + spent inputs
 * - Preserve encryption state (plaintext vs WPM ciphertext)
 */

import {
	ONESAT_BASKET,
	OPNS_BASKET,
	ORDINALS_BASKET,
	parseInputAssetLabels,
} from '@1sat/types'
import type { CreateActionArgs, WalletInterface } from '@bsv/sdk'
import { loadBasketOutput } from './loadBasketOutput.js'
import {
	type OrdinalRemittanceFields,
	overwriteOrdinalCiFields,
	remittanceFromOrdinalTags,
} from './ordinalRemittance.js'
import {
	encryptWalletMetadataCi,
	ensurePlaintextCi,
	looksLikeJson,
} from './walletMetadataCi.js'

const COLLECTABLE_BASKETS = new Set([
	ONESAT_BASKET,
	ORDINALS_BASKET,
	OPNS_BASKET,
])

async function carryFromInputs(
	wallet: WalletInterface,
	labels: string[] | undefined,
): Promise<Map<string, OrdinalRemittanceFields>> {
	const out = new Map<string, OrdinalRemittanceFields>()
	const refs = parseInputAssetLabels(labels ?? []).filter((r) =>
		COLLECTABLE_BASKETS.has(r.basket),
	)
	for (const ref of refs) {
		const loaded = await loadBasketOutput(wallet, ref.basket, ref.id)
		if ('error' in loaded) continue
		const fromTags = remittanceFromOrdinalTags(loaded.output.tags)
		let fromCi: OrdinalRemittanceFields = {}
		const ci = loaded.output.customInstructions
		if (ci && looksLikeJson(ci)) {
			try {
				const o = JSON.parse(ci) as Record<string, unknown>
				fromCi = {
					...(typeof o.origin === 'string' && { origin: o.origin }),
					...(typeof o.content === 'string' && { content: o.content }),
					...(typeof o.app === 'string' && { app: o.app }),
					...(typeof o.collection === 'string' && {
						collection: o.collection,
					}),
					...(typeof o.name === 'string' && { name: o.name }),
				}
			} catch {
				// ignore
			}
		}
		// CI preferred, tags fill gaps (same as BSV-21 read order).
		out.set(`${ref.basket}:${ref.id}`, {
			...fromTags,
			...fromCi,
		})
	}
	return out
}

function mergeAuth(
	fromTags: OrdinalRemittanceFields,
	fromInputs: OrdinalRemittanceFields[],
): OrdinalRemittanceFields {
	const auth: OrdinalRemittanceFields = { ...fromTags }
	for (const inp of fromInputs) {
		if (!auth.origin && inp.origin) auth.origin = inp.origin
		if (!auth.content && inp.content) auth.content = inp.content
		if (!auth.app && inp.app) auth.app = inp.app
		if (!auth.collection && inp.collection) auth.collection = inp.collection
		if (!auth.name && inp.name) auth.name = inp.name
	}
	return auth
}

/**
 * Overwrite ordinal/OpNS remittance on output CI from tags + input carry.
 * Call from {@link applyP1SatCreateAction}.
 */
export async function stampOrdinalOutputCustomInstructions(
	wallet: WalletInterface,
	args: CreateActionArgs,
): Promise<void> {
	const outputs = args.outputs
	if (!outputs?.length) return

	const carry = await carryFromInputs(wallet, args.labels)
	const carried = [...carry.values()]

	for (const out of outputs) {
		const raw = out.customInstructions
		const basket = out.basket?.trim().toLowerCase()
		if (!raw || !basket || !COLLECTABLE_BASKETS.has(basket)) continue

		const fromTags = remittanceFromOrdinalTags(out.tags)
		const auth = mergeAuth(fromTags, carried)
		if (
			!auth.origin &&
			!auth.content &&
			!auth.app &&
			!auth.collection &&
			!auth.name
		) {
			continue
		}

		const wasEncrypted = !looksLikeJson(raw)
		const plain = await ensurePlaintextCi(wallet, raw)
		if (!plain || !looksLikeJson(plain)) continue

		const merged = overwriteOrdinalCiFields(plain, auth)
		out.customInstructions = wasEncrypted
			? await encryptWalletMetadataCi(wallet, merged)
			: merged
	}
}
