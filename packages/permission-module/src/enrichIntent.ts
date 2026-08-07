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
	ORDFS_HOST,
	OPNS_BASKET,
	ORDINALS_BASKET,
	SIGMA_BASKET,
	parseInputAssetLabels,
	parseIntentLabel,
} from '@1sat/types'
import { Lock, OrdLock, outpointFromBytes } from '@1sat/templates'
import { parseAddress } from '@1sat/wallet'
import type {
	CreateActionArgs,
	CreateActionOutput,
	WalletInterface,
	WalletOutput,
} from '@bsv/sdk'
import { LockingScript, PushDrop, Script, Utils } from '@bsv/sdk'
import type { VerificationServices } from './types'

/**
 * Presentation fields on an OpNS bind: field 0 is the identity key and the
 * last is the signature, so field 1 is the display name and field 2 the
 * avatar origin. Decoded from the script because that is what the signature
 * covers — tags are only what the caller asserted.
 */
function decodeOpnsProfile(script: Script): {
	opnsProfileName?: string
	opnsAvatarOrigin?: string
} {
	let fields: number[][]
	try {
		fields = PushDrop.decode(LockingScript.fromHex(script.toHex())).fields
	} catch {
		return {}
	}
	if (fields.length < 3) return {}

	const body = fields.slice(0, -1)
	const unset = (f?: number[]) => !f?.length || (f.length === 1 && f[0] === 0)
	const name = body[1]
	const avatar = body[2]
	return {
		...(unset(name) ? {} : { opnsProfileName: Utils.toUTF8(name) }),
		...(unset(avatar) || avatar.length !== 36
			? {}
			: { opnsAvatarOrigin: outpointFromBytes(avatar) ?? undefined }),
	}
}

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
	/**
	 * Sale price decoded from an OrdLock locking script, in satoshis.
	 *
	 * Read this rather than the `price:` tag — the script is what the chain
	 * enforces, the tag is only what the caller asserted.
	 */
	listingPriceSats?: number
	/** Seller payout address decoded from an OrdLock locking script. */
	listingSeller?: string
	/**
	 * Block height decoded from a Lock locking script.
	 *
	 * Read this rather than the `until:` tag — the script is what the chain
	 * enforces, the tag is only what the caller asserted.
	 */
	lockUntilHeight?: number
	/**
	 * Display name published on an OpNS bind, decoded from the PushDrop.
	 *
	 * Read this rather than a tag — the signed script is what the approval
	 * actually commits to.
	 */
	opnsProfileName?: string
	/** Avatar origin outpoint (`txid_vout`) decoded from an OpNS bind. */
	opnsAvatarOrigin?: string
}

export type TrustState = 'verified' | 'unverified' | 'mismatch'

export interface EnrichedTrust {
	state: TrustState
	note?: string
}

export interface EnrichedIntent {
	kind: EnrichedIntentKind
	/** Explicit `p 1sat intent <domain>.<verb>` when present. */
	p1satIntent?: string
	/** One entry per `'p 1sat input <basket> <id>'` label. */
	inputs: EnrichedAsset[]
	/** All raw outputs with recipient decoded from script. */
	outputs: EnrichedOutput[]
	labels: string[]
	summary: string
	/** ORDFS or compatible content URL builder. */
	contentUrlForOrigin: (origin: string) => string
	chain: 'mainnet' | 'testnet'
	/** Purchase / hint-path trust after module re-resolve (from tags or default). */
	trust?: EnrichedTrust
	/** Overlay processing fee (not miner/DSAP). */
	indexerFeeSats?: number
	indexerFeeNote?: string
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
	/**
	 * Injected 1Sat services. When these carry `ordfs.getContentUrl`, card
	 * thumbnails resolve against the same host the rest of the app reads
	 * content from instead of the public default.
	 */
	services?: VerificationServices
}

export async function enrichIntent(
	wallet: WalletInterface,
	args: CreateActionArgs,
	opts: EnrichOptions = {},
): Promise<EnrichedIntent> {
	const chain = opts.chain ?? 'mainnet'
	// Bound, not detached — the real OrdfsClient method uses `this`.
	const ordfs = opts.services?.ordfs
	const getContentUrl = ordfs?.getContentUrl
		? (origin: string) => ordfs.getContentUrl?.(origin)
		: undefined
	const labels = args.labels ?? []
	const p1satIntent = parseIntentLabel(labels)

	const inputRefs = parseInputAssetLabels(labels)
	const inputs = (
		await Promise.all(
			inputRefs.map((ref) => lookupAsset(wallet, ref.basket, ref.id)),
		)
	).filter((a): a is EnrichedAsset => a !== null)

	const outputs = (args.outputs ?? []).map((out, i) =>
		decodeOutput(out, i, chain),
	)

	const kind = detectKind(inputs, outputs, p1satIntent)
	const summary = buildSummary(kind, inputs, outputs, p1satIntent)
	const trust = initialTrust(p1satIntent)
	const fee = extractIndexerFee(args, outputs)

	return {
		kind,
		p1satIntent,
		inputs,
		outputs,
		labels,
		summary,
		contentUrlForOrigin: (origin) =>
			getContentUrl?.(origin) ?? contentUrlFromOrigin(ORDFS_HOST, origin),
		chain,
		trust,
		...fee,
	}
}

/**
 * Trust is a property of a check performed *now*, never of the asset.
 *
 * A `trust:` tag can't be written truthfully at broadcast time — the overlay
 * generally hasn't indexed the transaction yet — so any such tag in storage is
 * meaningless or a lie, and outputs are dApp-authored besides. Nothing
 * persisted may influence the badge.
 *
 * Every purchase therefore starts `unverified`; `verifyIntent` upgrades it if
 * and when a service positively answers.
 */
function initialTrust(p1satIntent?: string): EnrichedTrust | undefined {
	const isPurchase =
		p1satIntent === 'ordinal.purchase' ||
		p1satIntent === 'opns.purchase' ||
		p1satIntent === 'bsv21.purchase'
	if (!isPurchase) return undefined
	return { state: 'unverified' }
}

function extractIndexerFee(
	args: CreateActionArgs,
	outputs: EnrichedOutput[],
): { indexerFeeSats?: number; indexerFeeNote?: string } {
	// Overlay fee outs: unbasketed, description-free (encrypted), typically
	// modest fixed amounts. Prefer tag `fee:overlay` if present; else detect
	// outputDescription is unavailable — use tag on args outputs if action set it.
	const rawOuts = args.outputs ?? []
	let feeSats = 0
	let tokenOuts = 0
	for (let i = 0; i < rawOuts.length; i++) {
		const tags = rawOuts[i].tags ?? []
		if (tags.some((t) => t === 'fee:overlay' || t.startsWith('indexer-fee'))) {
			feeSats += rawOuts[i].satoshis ?? 0
		}
		if (
			rawOuts[i].basket === BSV21_BASKET ||
			tags.some((t) => t.startsWith('bsv21:'))
		) {
			tokenOuts++
		}
	}
	// No fallback. The `fee:overlay` tag is a hint from the action; when it is
	// absent we show nothing rather than guessing which output is the fee.
	//
	// The previous heuristic took the last unbasketed output under 50k sats and
	// labelled it a fee. On a purchase that picks up the seller payment, so the
	// same output rendered twice — once as Price, once as Indexer fee.
	//
	// The real check belongs on the verification promise: the overlay publishes
	// `fee_address` and `fee_per_output` in `getTokenDetails`, and `decodeOutput`
	// already resolves each output's recipient from its locking script, so fee
	// outputs are the ones paying `fee_address`. Exact, not inferred.
	if (!feeSats) return {}
	const note =
		tokenOuts > 0
			? `${feeSats.toLocaleString()} sats overlay fee` +
				(tokenOuts > 1 ? ` (${tokenOuts} token outs)` : '')
			: `${feeSats.toLocaleString()} sats overlay fee`
	return { indexerFeeSats: feeSats, indexerFeeNote: note }
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
	const ordLock = OrdLock.decode(script, chain === 'mainnet')
	if (ordLock) {
		enriched.listingPriceSats = Number(ordLock.price)
		enriched.listingSeller = ordLock.seller
	}

	const lock = Lock.decode(script, chain === 'mainnet')
	if (lock) {
		enriched.lockUntilHeight = lock.until
	}

	if (out.basket === OPNS_BASKET) {
		Object.assign(enriched, decodeOpnsProfile(script))
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
	p1satIntent?: string,
): EnrichedIntentKind {
	// Prefer explicit intent labels over heuristics.
	if (p1satIntent?.startsWith('opns.')) return 'opns'
	if (p1satIntent === 'ordinal.list' || p1satIntent === 'bsv21.list')
		return 'listing'
	if (
		p1satIntent === 'ordinal.cancel-listing' ||
		p1satIntent === 'opns.cancel-listing'
	)
		return 'cancel-listing'
	if (
		p1satIntent === 'ordinal.purchase' ||
		p1satIntent === 'opns.purchase' ||
		p1satIntent === 'bsv21.purchase'
	)
		return 'purchase'
	if (p1satIntent === 'ordinal.transfer') return 'ordinal-transfer'
	if (p1satIntent === 'bsv21.transfer') return 'token-transfer'
	if (p1satIntent === 'lock.lock') return 'lock'
	if (p1satIntent === 'lock.unlock') return 'unlock'
	if (
		p1satIntent === 'ordinal.inscribe' ||
		p1satIntent === 'ordinal.inscribe-sigma'
	)
		return 'inscription'

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
	intentId?: string,
): string {
	if (intentId) {
		const named = summaryFromIntentId(intentId, inputs, outputs)
		if (named) return named
	}
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
			const out =
				outputs.find((o) => o.listingPriceSats !== undefined) ??
				outputs.find((o) => o.tags.some((t) => t.startsWith('price:')))
			// Script-decoded price only — the `price:` tag is caller-asserted.
			const price = out?.listingPriceSats
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

function summaryFromIntentId(
	intentId: string,
	inputs: EnrichedAsset[],
	outputs: EnrichedOutput[],
): string | undefined {
	const name =
		tagValue(inputs[0]?.tags, 'name') ??
		tagValue(outputs.find((o) => o.basket === OPNS_BASKET)?.tags, 'name')
	const what = name ? `“${name}”` : undefined
	switch (intentId) {
		case 'opns.register':
			return what ? `Publish name ${what}` : 'Publish OpNS name'
		case 'opns.deregister':
			return what ? `Unpublish name ${what}` : 'Unpublish OpNS name'
		case 'opns.list':
			return what ? `List name ${what} for sale` : 'List OpNS name for sale'
		case 'opns.transfer':
			return what ? `Transfer name ${what}` : 'Transfer OpNS name'
		case 'opns.cancel-listing':
			return what ? `Cancel listing of ${what}` : 'Cancel OpNS listing'
		case 'opns.purchase':
			return what ? `Buy name ${what}` : 'Buy OpNS name'
		case 'ordinal.transfer':
			return 'Send ordinal'
		case 'ordinal.list':
			return 'List ordinal for sale'
		case 'ordinal.cancel-listing':
			return 'Cancel ordinal listing'
		case 'ordinal.purchase':
			return 'Buy ordinal'
		case 'ordinal.burn':
			return 'Burn ordinal'
		case 'ordinal.inscribe':
		case 'ordinal.inscribe-sigma':
			return 'Create inscription'
		case 'ordinal.mint-collection':
			return 'Mint collection'
		case 'ordinal.mint-item':
			return 'Mint collection item'
		case 'lock.lock':
			return 'Lock BSV'
		case 'lock.unlock':
			return 'Unlock BSV'
		case 'bsv21.transfer':
			return 'Send tokens'
		case 'bsv21.purchase':
			return 'Buy tokens'
		case 'bsv21.mint':
			return 'Mint tokens'
		case 'bsv21.deploy':
			return 'Deploy token'
		default:
			return undefined
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
