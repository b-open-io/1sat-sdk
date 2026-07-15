/**
 * Build a structured prompt intent from the createAction args the
 * WalletPermissionsManager hands the module.
 *
 * `WalletPermissionsManager.createAction` encrypts `args.description`,
 * `inputDescription`, `outputDescription`, and `customInstructions`
 * before dispatching to permission modules — so we can't read them.
 * What's left:
 *
 *   - `args.labels`            — unencrypted; carries our `'p 1sat input <basket> <id>'`
 *                                / `'p 1sat output <basket> <id>'` lookup keys
 *   - `args.outputs[i].lockingScript` — decode P2PKH for recipient address
 *   - `args.outputs[i].satoshis`
 *
 * Trust model: input metadata is fetched by id from the wallet's own
 * storage — not from anything the dApp could fabricate in args. Output
 * recipients come from the locking-script bytes (cryptographically
 * committed to the final tx). The dApp can't lie about what the user
 * is being asked to approve.
 */

import {
	BAP_BASKET,
	BSOCIAL_BASKET,
	BSV21_AUTH_BASKET,
	BSV21_BASKET,
	LOCK_BASKET,
	OPNS_BASKET,
	ORDINALS_BASKET,
	P1SAT_BASKET_PREFIX,
	P1SAT_INPUT_LABEL_PREFIX,
	SIGMA_BASKET,
} from '@1sat/types'
import { parseAddress } from '@1sat/wallet'
import type {
	CreateActionArgs,
	CreateActionOutput,
	WalletInterface,
	WalletOutput,
} from '@bsv/sdk'
import { Script } from '@bsv/sdk'

export type EnrichedIntentKind =
	| 'ordinal-transfer'
	| 'token-transfer'
	| 'lock'
	| 'unlock'
	| 'inscription'
	| 'listing'
	| 'cancel-listing'
	| 'purchase'
	| 'social-post'
	| 'opns'
	| 'unknown'

/** A successful (basket, id) lookup against the wallet's storage. */
export interface EnrichedAsset {
	basket: string
	id: string
	outpoint: string
	satoshis: number
	tags: string[]
	customInstructions?: string
}

export interface EnrichedOutput {
	index: number
	satoshis: number
	basket?: string
	tags: string[]
	/** Recipient address if the locking script is P2PKH (or P2PKH-suffixed). */
	recipient?: string
}

export interface EnrichedIntent {
	kind: EnrichedIntentKind
	/** One entry per `'p 1sat input <basket> <id>'` label. */
	inputs: EnrichedAsset[]
	/** All raw outputs with recipient decoded from script. */
	outputs: EnrichedOutput[]
	labels: string[]
	summary: string
	/** ORDFS or compatible content URL builder. */
	contentUrlForOrigin: (origin: string) => string
	chain: 'mainnet' | 'testnet'
}

const ASSET_BASKETS = [
	ORDINALS_BASKET,
	BSV21_BASKET,
	BSV21_AUTH_BASKET,
	LOCK_BASKET,
	OPNS_BASKET,
	BSOCIAL_BASKET,
	SIGMA_BASKET,
	BAP_BASKET,
]

interface EnrichOptions {
	chain?: 'mainnet' | 'testnet'
	contentHost?: string
}

export async function enrichIntent(
	wallet: WalletInterface,
	args: CreateActionArgs,
	opts: EnrichOptions = {},
): Promise<EnrichedIntent> {
	const chain = opts.chain ?? 'mainnet'
	const contentHost = opts.contentHost ?? 'https://ordfs.network'
	const labels = args.labels ?? []

	const inputRefs = parseAssetLabels(labels, P1SAT_INPUT_LABEL_PREFIX)
	const inputs = (
		await Promise.all(
			inputRefs.map((ref) => lookupAsset(wallet, ref.basket, ref.id)),
		)
	).filter((a): a is EnrichedAsset => a !== null)

	const outputs = (args.outputs ?? []).map((out, i) =>
		decodeOutput(out, i, chain),
	)

	const kind = detectKind(inputs, outputs)
	const summary = buildSummary(kind, inputs, outputs)

	return {
		kind,
		inputs,
		outputs,
		labels,
		summary,
		contentUrlForOrigin: (origin) => contentUrlFromOrigin(contentHost, origin),
		chain,
	}
}

// ---------------------------------------------------------------------------
// Label parsing — `'p 1sat input <basket> <id>'`
// ---------------------------------------------------------------------------

interface AssetLabelRef {
	basket: string
	id: string
}

function parseAssetLabels(labels: string[], prefix: string): AssetLabelRef[] {
	const refs: AssetLabelRef[] = []
	for (const label of labels) {
		if (!label.startsWith(prefix)) continue
		const payload = label.slice(prefix.length).trim()
		const sep = payload.indexOf(' ')
		if (sep <= 0) continue
		const suffix = payload.slice(0, sep)
		const id = payload.slice(sep + 1).trim()
		if (!suffix || !id) continue
		refs.push({ basket: `${P1SAT_BASKET_PREFIX}${suffix}`, id })
	}
	return refs
}

// ---------------------------------------------------------------------------
// Asset lookup — indexed `listOutputs` query by `id:<id>` tag.
// ---------------------------------------------------------------------------

async function lookupAsset(
	wallet: WalletInterface,
	basket: string,
	id: string,
): Promise<EnrichedAsset | null> {
	// Only query baskets the module knows about — guards against malicious
	// labels pointing at unrelated baskets.
	if (!ASSET_BASKETS.includes(basket)) return null
	try {
		const result = await wallet.listOutputs({
			basket,
			tags: [`id:${id}`],
			tagQueryMode: 'all',
			includeTags: true,
			includeCustomInstructions: true,
			limit: 1,
		})
		const match = result.outputs[0]
		if (!match) return null
		return {
			basket,
			id,
			outpoint: match.outpoint,
			satoshis: match.satoshis,
			tags: match.tags ?? [],
			customInstructions: (
				match as WalletOutput & { customInstructions?: string }
			).customInstructions,
		}
	} catch {
		return null
	}
}

// ---------------------------------------------------------------------------
// Output decoding — recipient address from the (committed) locking script.
// ---------------------------------------------------------------------------

function decodeOutput(
	out: CreateActionOutput,
	index: number,
	chain: 'mainnet' | 'testnet',
): EnrichedOutput {
	const enriched: EnrichedOutput = {
		index,
		satoshis: out.satoshis ?? 0,
		basket: out.basket,
		tags: out.tags ?? [],
	}
	if (!out.lockingScript) return enriched
	let script: Script
	try {
		script = Script.fromHex(out.lockingScript)
	} catch {
		return enriched
	}
	const recipient = parseAddress(script, 0, chain)
	if (recipient) {
		enriched.recipient = recipient
		return enriched
	}
	// Inscription envelope or other suffix-bearing scripts — try parsing
	// P2PKH after OP_ENDIF.
	const endifIndex = script.chunks.findIndex((c) => c.op === 0x68)
	if (endifIndex > 0) {
		const after = parseAddress(script, endifIndex + 1, chain)
		if (after) enriched.recipient = after
	}
	return enriched
}

// ---------------------------------------------------------------------------
// Intent classification — driven by input asset basket membership.
// ---------------------------------------------------------------------------

function hasListingTags(tags: string[]): boolean {
	return tags.some((t) => t === 'ordlock' || t.startsWith('price:'))
}

function detectKind(
	inputs: EnrichedAsset[],
	outputs: EnrichedOutput[],
): EnrichedIntentKind {
	// Cancel listing: spending an ordlock-tagged input back to a P2PKH owner.
	// Listings live in the basket of the listed asset (ordinals, opns, …),
	// so the ordlock/price tags are the marker, not the basket.
	if (inputs.some((i) => hasListingTags(i.tags))) {
		return 'cancel-listing'
	}

	// New listing: output carrying the ordlock/price tags into an asset basket.
	if (
		outputs.some(
			(o) =>
				o.basket && ASSET_BASKETS.includes(o.basket) && hasListingTags(o.tags),
		)
	) {
		return 'listing'
	}

	if (inputs.some((i) => i.basket === ORDINALS_BASKET))
		return 'ordinal-transfer'
	if (inputs.some((i) => i.basket === BSV21_BASKET)) return 'token-transfer'
	if (inputs.some((i) => i.basket === LOCK_BASKET)) return 'unlock'
	if (inputs.some((i) => i.basket === OPNS_BASKET)) return 'opns'

	if (outputs.some((o) => o.basket === LOCK_BASKET)) return 'lock'
	if (outputs.some((o) => o.basket === BSOCIAL_BASKET)) return 'social-post'
	// OpNS self-transfers (register/deregister) when the input label didn't
	// resolve — the output still lands in the opns basket.
	if (outputs.some((o) => o.basket === OPNS_BASKET)) return 'opns'

	// Purchase: an asset is landing in our basket AND there's a non-trivial
	// payment going to an unbasketed recipient (the seller). No labeled
	// wallet inputs — the listing being spent is external.
	const hasAssetIncoming = outputs.some(
		(o) => o.basket === ORDINALS_BASKET || o.basket === BSV21_BASKET,
	)
	const hasSellerPayment = outputs.some(
		(o) => !o.basket && o.recipient && o.satoshis > 1,
	)
	if (inputs.length === 0 && hasAssetIncoming && hasSellerPayment) {
		return 'purchase'
	}

	if (outputs.some((o) => o.basket === ORDINALS_BASKET)) return 'inscription'
	if (outputs.some((o) => o.basket === BSV21_BASKET)) return 'token-transfer'

	return 'unknown'
}

function buildSummary(
	kind: EnrichedIntentKind,
	inputs: EnrichedAsset[],
	outputs: EnrichedOutput[],
): string {
	switch (kind) {
		case 'ordinal-transfer': {
			const recipient = outputs.find((o) => o.recipient)?.recipient
			const name = tagValue(inputs[0]?.tags, 'name')
			const what = name ? `“${name}”` : 'an ordinal'
			return recipient
				? `Send ${what} to ${truncate(recipient, 18)}`
				: `Send ${what}`
		}
		case 'token-transfer': {
			const sym = tagValue(inputs[0]?.tags, 'sym') ?? 'tokens'
			const recipient = outputs.find((o) => o.recipient)?.recipient
			return recipient
				? `Send ${sym} to ${truncate(recipient, 18)}`
				: `Send ${sym}`
		}
		case 'lock':
			return `Lock funds`
		case 'unlock':
			return `Unlock matured locks`
		case 'inscription': {
			const ct = tagValue(outputs[0]?.tags, 'type')
			return ct ? `Inscribe ${ct}` : `Create inscription`
		}
		case 'listing': {
			const out = outputs.find((o) =>
				o.tags.some((t) => t.startsWith('price:')),
			)
			const price = tagValue(out?.tags, 'price')
			// The listing output carries name/origin tags too — fall back to
			// them when no input label resolved.
			const name =
				tagValue(inputs[0]?.tags, 'name') ?? tagValue(out?.tags, 'name')
			const what = name ? `“${name}”` : 'an ordinal'
			return price ? `List ${what} for ${price} sats` : `List ${what} for sale`
		}
		case 'cancel-listing': {
			const name = tagValue(inputs[0]?.tags, 'name')
			const what = name ? `“${name}”` : 'an ordinal'
			return `Cancel listing of ${what}`
		}
		case 'social-post':
			return `Create social post`
		case 'opns': {
			const name =
				tagValue(inputs[0]?.tags, 'name') ??
				tagValue(outputs.find((o) => o.basket === OPNS_BASKET)?.tags, 'name')
			return name ? `Update OpNS name “${name}”` : 'OpNS operation'
		}
		default:
			return `Approve transaction`
	}
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function tagValue(
	tags: string[] | undefined,
	key: string,
): string | undefined {
	if (!tags) return undefined
	const prefix = `${key}:`
	for (const t of tags) {
		if (t.startsWith(prefix)) return t.slice(prefix.length)
	}
	return undefined
}

function truncate(s: string, max: number): string {
	if (s.length <= max) return s
	return `${s.slice(0, max - 3)}…`
}

function contentUrlFromOrigin(host: string, origin: string): string {
	const trimmed = host.replace(/\/$/, '')
	const formatted = origin.replace('.', '_')
	return `${trimmed}/${formatted}`
}
