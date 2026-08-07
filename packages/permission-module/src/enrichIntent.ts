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

/** Recognized locking-script template for a tx leg. */
export type ScriptTemplateKind =
	| 'p2pkh'
	| 'ordlock'
	| 'lock'
	| 'pushdrop'
	| 'sigma'
	| 'unrecognized'

/**
 * One understood (or partially understood) input or output in the action.
 * Non-ordinal detail and seal callouts; ordinal tip→tip stories use {@link OrdinalEdge}.
 */
export interface TxLeg {
	side: 'input' | 'output'
	index: number
	satoshis: number
	template: ScriptTemplateKind
	/** Short human line for this leg. */
	label: string
	/** Apply will write a signature into this output script. */
	sealPending?: boolean
	sealKind?: 'pushdrop' | 'sigma'
	basket?: string
	tags?: string[]
	id?: string
	outpoint?: string
	recipient?: string
	listingPriceSats?: number
	listingSeller?: string
	lockUntilHeight?: number
	opnsProfileName?: string
	opnsAvatarOrigin?: string
	origin?: string
	name?: string
	/** True when this leg is part of an {@link OrdinalEdge} (UI may de-dupe). */
	inOrdinalEdge?: boolean
}

/**
 * Ordinal (or OpNS-like 1-sat collectable) tip→tip story.
 * Derived from input/output shape — same vocabulary as BRC-303 operation table.
 */
export type OrdinalOperation =
	| 'inscribe'
	| 'transfer'
	| 'burn'
	| 'list'
	| 'cancel-listing'
	| 'purchase'

export interface OrdinalEdge {
	operation: OrdinalOperation
	title: string
	summary: string
	/** Wallet-owned spend when known from input labels. */
	spend?: {
		basket: string
		id: string
		outpoint: string
		satoshis: number
		tags: string[]
		name?: string
		origin?: string
		isListing?: boolean
	}
	/** Resulting collectable / listing output when present. */
	create?: {
		index: number
		satoshis: number
		basket?: string
		tags: string[]
		template?: ScriptTemplateKind
		sealPending?: boolean
		sealKind?: 'pushdrop' | 'sigma'
		recipient?: string
		listingPriceSats?: number
		listingSeller?: string
		opnsProfileName?: string
		opnsAvatarOrigin?: string
		name?: string
		origin?: string
	}
}

export interface EnrichedOutput {
	index: number
	satoshis: number
	basket?: string
	tags: string[]
	template?: ScriptTemplateKind
	/** Apply will seal a placeholder signature in this output. */
	sealPending?: boolean
	sealKind?: 'pushdrop' | 'sigma'
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
	/** One entry per `'p 1sat input <basket> <id>'` label. */
	inputs: EnrichedAsset[]
	/** All raw outputs with recipient decoded from script. */
	outputs: EnrichedOutput[]
	/**
	 * Per-leg detail for the prompt body (templates, seals, non-ordinal outs).
	 * Header still uses `kind` / `summary`.
	 */
	legs: TxLeg[]
	/**
	 * Ordinal/OpNS tip→tip operations (send, list, buy, …).
	 * Rich UI helpers key off `operation`, not whole-tx kind alone.
	 */
	ordinalEdges: OrdinalEdge[]
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

	const inputRefs = parseInputAssetLabels(labels)
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
	const trust = initialTrust(kind)
	const fee = extractIndexerFee(args, outputs)
	const ordinalEdges = buildOrdinalEdges(inputs, outputs)
	const legs = buildLegs(inputs, outputs, ordinalEdges)

	return {
		kind,
		inputs,
		outputs,
		legs,
		ordinalEdges,
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
function initialTrust(kind: EnrichedIntentKind): EnrichedTrust | undefined {
	if (kind !== 'purchase') return undefined
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
		template: 'unrecognized',
	}
	if (!out.lockingScript) return enriched
	let script: Script
	try {
		script = Script.fromHex(out.lockingScript)
	} catch {
		return enriched
	}

	const classified = classifyScript(script, chain, out.basket)
	Object.assign(enriched, classified)

	if (out.basket === OPNS_BASKET || classified.template === 'pushdrop') {
		Object.assign(enriched, decodeOpnsProfile(script))
	}

	return enriched
}

function classifyScript(
	script: Script,
	chain: 'mainnet' | 'testnet',
	basket?: string,
): Partial<EnrichedOutput> {
	const main = chain === 'mainnet'
	const ordLock = OrdLock.decode(script, main)
	if (ordLock) {
		return {
			template: 'ordlock',
			listingPriceSats: Number(ordLock.price),
			listingSeller: ordLock.seller,
		}
	}

	const lock = Lock.decode(script, main)
	if (lock) {
		return {
			template: 'lock',
			lockUntilHeight: lock.until,
		}
	}

	if (scriptContainsAscii(script, 'SIGMA')) {
		const sealPending = hasZeroedSigmaSig(script)
		return {
			template: 'sigma',
			...(sealPending ? { sealPending: true, sealKind: 'sigma' as const } : {}),
			...p2pkhRecipient(script, chain),
		}
	}

	try {
		const fields = PushDrop.decode(
			LockingScript.fromHex(script.toHex()),
		).fields
		if (fields.length >= 2) {
			const last = fields[fields.length - 1]
			const sealPending = !!last?.length && last.every((b) => b === 0)
			return {
				template: 'pushdrop',
				...(sealPending
					? { sealPending: true, sealKind: 'pushdrop' as const }
					: {}),
			}
		}
	} catch {
		// not PushDrop
	}

	const recipient = p2pkhRecipient(script, chain)
	if (recipient.recipient) {
		return { template: 'p2pkh', ...recipient }
	}

	return { template: basket ? 'unrecognized' : 'unrecognized' }
}

function p2pkhRecipient(
	script: Script,
	chain: 'mainnet' | 'testnet',
): { recipient?: string } {
	const recipient = parseAddress(script, 0, chain)
	if (recipient) return { recipient }
	const endifIndex = script.chunks.findIndex((c) => c.op === 0x68)
	if (endifIndex > 0) {
		const after = parseAddress(script, endifIndex + 1, chain)
		if (after) return { recipient: after }
	}
	return {}
}

function scriptContainsAscii(script: Script, ascii: string): boolean {
	const needle = Utils.toArray(ascii)
	const hay = script.toBinary()
	if (hay.length < needle.length) return false
	outer: for (let i = 0; i <= hay.length - needle.length; i++) {
		for (let j = 0; j < needle.length; j++) {
			if (hay[i + j] !== needle[j]) continue outer
		}
		return true
	}
	return false
}

/** True when a SIGMA tape's signature field is still all zeros. */
function hasZeroedSigmaSig(script: Script): boolean {
	const bin = script.toBinary()
	const sigma = Utils.toArray('SIGMA')
	for (let i = 0; i <= bin.length - sigma.length - 70; i++) {
		let match = true
		for (let j = 0; j < sigma.length; j++) {
			if (bin[i + j] !== sigma[j]) {
				match = false
				break
			}
		}
		if (!match) continue
		// After SIGMA marker, look for a run of 65 zero bytes (compact sig placeholder).
		const slice = bin.slice(i + sigma.length, i + sigma.length + 80)
		let zeros = 0
		for (const b of slice) {
			if (b === 0) zeros++
			else if (zeros >= 60) return true
			else zeros = 0
		}
		if (zeros >= 60) return true
	}
	return false
}

function isCollectableBasket(basket?: string): boolean {
	return (
		basket === ORDINALS_BASKET ||
		basket === OPNS_BASKET ||
		// plain-name future + legacy
		basket === '1sat' ||
		!!basket?.includes('ordinal') ||
		!!basket?.includes('opns')
	)
}

/**
 * Pair collectable spends with their next tip/listing (BRC-303 shapes).
 */
function buildOrdinalEdges(
	inputs: EnrichedAsset[],
	outputs: EnrichedOutput[],
): OrdinalEdge[] {
	const edges: OrdinalEdge[] = []
	const usedOut = new Set<number>()

	const takeOut = (
		pred: (o: EnrichedOutput) => boolean,
	): EnrichedOutput | undefined => {
		const hit = outputs.find((o) => !usedOut.has(o.index) && pred(o))
		if (hit) usedOut.add(hit.index)
		return hit
	}

	const collectableIns = inputs.filter(
		(i) => isCollectableBasket(i.basket) || hasListingTags(i.tags),
	)
	const usedIn = new Set<string>()

	for (const inp of collectableIns) {
		usedIn.add(inp.id)
		const name = tagValue(inp.tags, 'name')
		const origin = tagValue(inp.tags, 'origin')
		const spend = {
			basket: inp.basket,
			id: inp.id,
			outpoint: inp.outpoint,
			satoshis: inp.satoshis,
			tags: inp.tags,
			...(name ? { name } : {}),
			...(origin ? { origin } : {}),
			isListing: hasListingTags(inp.tags),
		}

		if (hasListingTags(inp.tags)) {
			// cancel: listing in → held collectable out (not ordlock)
			const create = takeOut(
				(o) =>
					isCollectableBasket(o.basket) &&
					o.template !== 'ordlock' &&
					o.satoshis === 1,
			)
			edges.push(
				edge(
					'cancel-listing',
					spend,
					create,
					name ? `Cancel listing of “${name}”` : 'Cancel listing',
					'Return collectable from marketplace lock',
				),
			)
			continue
		}

		const listOut = takeOut((o) => o.template === 'ordlock' && o.satoshis === 1)
		if (listOut) {
			const price = listOut.listingPriceSats
			edges.push(
				edge(
					'list',
					spend,
					listOut,
					name ? `List “${name}”` : 'List collectable',
					price != null
						? `List for ${price} sats`
						: 'List on marketplace lock',
				),
			)
			continue
		}

		const next = takeOut(
			(o) =>
				(isCollectableBasket(o.basket) || o.satoshis === 1) &&
				o.template !== 'ordlock',
		)
		if (!next) {
			edges.push(
				edge(
					'burn',
					spend,
					undefined,
					name ? `Burn “${name}”` : 'Burn collectable',
					'No collectable output — tip ends',
				),
			)
			continue
		}

		// transfer (self-keep or external)
		const external = Boolean(next.recipient)
		edges.push(
			edge(
				'transfer',
				spend,
				next,
				name ? `Send “${name}”` : 'Send collectable',
				external && next.recipient
					? `To ${truncate(next.recipient, 18)}`
					: 'Move collectable',
			),
		)
	}

	// purchase / inscribe: collectable outs with no matching wallet spend
	for (const out of outputs) {
		if (usedOut.has(out.index)) continue
		if (!isCollectableBasket(out.basket) && out.template !== 'ordlock') {
			// 1-sat sigma/inscribe without basket still counts
			if (!(out.satoshis === 1 && (out.template === 'sigma' || out.sealPending))) {
				continue
			}
		}
		if (out.template === 'ordlock') continue

		const name =
			out.opnsProfileName ?? tagValue(out.tags, 'name') ?? undefined
		const origin = tagValue(out.tags, 'origin')
		const hasSellerPay = outputs.some(
			(o) => !o.basket && o.recipient && o.satoshis > 1,
		)
		const bareOrigin = out.tags.includes('origin')

		if (hasSellerPay && collectableIns.length === 0) {
			usedOut.add(out.index)
			edges.push(
				edge(
					'purchase',
					undefined,
					out,
					name ? `Buy “${name}”` : 'Buy collectable',
					'Receive collectable from marketplace',
				),
			)
			continue
		}

		if (collectableIns.length === 0 || bareOrigin || out.template === 'sigma') {
			usedOut.add(out.index)
			edges.push(
				edge(
					'inscribe',
					undefined,
					out,
					name ? `Inscribe “${name}”` : 'Create inscription',
					out.sealPending
						? 'New origin (signature seal pending)'
						: 'New collectable output',
				),
			)
		}
	}

	return edges
}

function edge(
	operation: OrdinalOperation,
	spend: OrdinalEdge['spend'],
	create: EnrichedOutput | undefined,
	title: string,
	summary: string,
): OrdinalEdge {
	const name =
		create?.opnsProfileName ??
		tagValue(create?.tags, 'name') ??
		spend?.name
	const origin = tagValue(create?.tags, 'origin') ?? spend?.origin
	return {
		operation,
		title,
		summary,
		...(spend ? { spend } : {}),
		...(create
			? {
					create: {
						index: create.index,
						satoshis: create.satoshis,
						basket: create.basket,
						tags: create.tags,
						template: create.template,
						sealPending: create.sealPending,
						sealKind: create.sealKind,
						recipient: create.recipient,
						listingPriceSats: create.listingPriceSats,
						listingSeller: create.listingSeller,
						opnsProfileName: create.opnsProfileName,
						opnsAvatarOrigin: create.opnsAvatarOrigin,
						...(name ? { name } : {}),
						...(origin ? { origin } : {}),
					},
				}
			: {}),
	}
}

function buildLegs(
	inputs: EnrichedAsset[],
	outputs: EnrichedOutput[],
	ordinalEdges: OrdinalEdge[],
): TxLeg[] {
	const edgeOutIdx = new Set(
		ordinalEdges
			.map((e) => e.create?.index)
			.filter((i): i is number => i != null),
	)
	const edgeInIds = new Set(
		ordinalEdges.map((e) => e.spend?.id).filter((id): id is string => !!id),
	)

	const legs: TxLeg[] = []
	for (const [i, inp] of inputs.entries()) {
		const name = tagValue(inp.tags, 'name')
		const origin = tagValue(inp.tags, 'origin')
		const listing = hasListingTags(inp.tags)
		const inOrdinalEdge = edgeInIds.has(inp.id)
		legs.push({
			side: 'input',
			index: i,
			satoshis: inp.satoshis,
			template: listing ? 'ordlock' : 'unrecognized',
			label: legLabelInput(inp, name, listing),
			basket: inp.basket,
			tags: inp.tags,
			id: inp.id,
			outpoint: inp.outpoint,
			inOrdinalEdge,
			...(name ? { name } : {}),
			...(origin ? { origin } : {}),
		})
	}
	for (const out of outputs) {
		const name =
			out.opnsProfileName ?? tagValue(out.tags, 'name') ?? undefined
		const origin = tagValue(out.tags, 'origin')
		const inOrdinalEdge = edgeOutIdx.has(out.index)
		legs.push({
			side: 'output',
			index: out.index,
			satoshis: out.satoshis,
			template: out.template ?? 'unrecognized',
			label: legLabelOutput(out, name),
			inOrdinalEdge,
			...(out.sealPending
				? { sealPending: true, sealKind: out.sealKind }
				: {}),
			basket: out.basket,
			tags: out.tags,
			recipient: out.recipient,
			listingPriceSats: out.listingPriceSats,
			listingSeller: out.listingSeller,
			lockUntilHeight: out.lockUntilHeight,
			opnsProfileName: out.opnsProfileName,
			opnsAvatarOrigin: out.opnsAvatarOrigin,
			...(name ? { name } : {}),
			...(origin ? { origin } : {}),
		})
	}
	return legs
}

function legLabelInput(
	inp: EnrichedAsset,
	name: string | undefined,
	listing: boolean,
): string {
	const what = name ? `“${name}”` : inp.basket
	if (listing) return `Spend listing ${what}`
	return `Spend ${what} (${inp.satoshis} sats)`
}

function legLabelOutput(out: EnrichedOutput, name?: string): string {
	const parts: string[] = []
	if (out.sealPending && out.sealKind === 'sigma') {
		parts.push('Sign Sigma on output')
	} else if (out.sealPending && out.sealKind === 'pushdrop') {
		parts.push('Sign PushDrop on output')
	} else if (out.template === 'ordlock' && out.listingPriceSats != null) {
		parts.push(`List for ${out.listingPriceSats} sats`)
	} else if (out.template === 'lock' && out.lockUntilHeight != null) {
		parts.push(`Lock until height ${out.lockUntilHeight}`)
	} else if (out.template === 'sigma') {
		parts.push('Sigma-signed output')
	} else if (out.template === 'pushdrop') {
		parts.push(name ? `PushDrop “${name}”` : 'PushDrop output')
	} else if (out.recipient) {
		parts.push(`Pay ${truncate(out.recipient, 18)}`)
	} else if (out.basket) {
		parts.push(`File to ${out.basket}`)
	} else {
		parts.push(
			out.template === 'unrecognized'
				? 'Unrecognized script'
				: 'Output',
		)
	}
	if (name && !parts[0]?.includes(name)) parts.push(`“${name}”`)
	parts.push(`${out.satoshis} sats`)
	return parts.join(' · ')
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
			const out = outputs.find((o) => o.basket === OPNS_BASKET)
			const name =
				tagValue(inputs[0]?.tags, 'name') ?? tagValue(out?.tags, 'name')
			const published = out?.tags.includes('opns:published')
			if (published) {
				return name ? `Publish name “${name}”` : 'Publish OpNS name'
			}
			return name ? `OpNS operation on “${name}”` : 'OpNS operation'
		}
		case 'purchase': {
			const name =
				tagValue(outputs[0]?.tags, 'name') ?? tagValue(inputs[0]?.tags, 'name')
			return name ? `Buy “${name}”` : 'Buy asset'
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
