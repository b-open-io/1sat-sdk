import { P1SAT_BASKET_PREFIX, parseIntentLabel } from '@1sat/types'
import type { IPermissionStore } from '@1sat/wallet'
import type {
	CreateActionArgs,
	CreateActionResult,
	CreateSignatureArgs,
	GetPublicKeyArgs,
	InternalizeActionArgs,
	ListOutputsArgs,
	WalletInterface,
} from '@bsv/sdk'
import { Transaction } from '@bsv/sdk'
import { applyCreateAction } from './apply'
import type { CommitmentCache } from './commitmentCache'
import { enrichIntent } from './enrichIntent'
import { computeHashOutputs } from './hashOutputs'
import { MIN_BIP143_PREIMAGE_BYTES, parsePreimage } from './sighashParser'
import type { PromptHandler, VerificationServices } from './types'
import { verifyIntent } from './verifyIntent'

interface HandlerDeps {
	/** Base wallet — apply crypto never uses a gated wrapper. */
	wallet: WalletInterface
	promptHandler: PromptHandler
	cache: CommitmentCache
	adminOriginator?: string
	permissionStore?: IPermissionStore
	services?: VerificationServices
}

/**
 * createAction onRequest:
 *   1. dApp: enrich (wallet re-lookup) → prompt → reject throws.
 *   2. Admin: no prompt.
 *   3. Always apply on base wallet (admin silent; dApp after approve).
 *      Mutates args in place (PushDrop seal, etc.).
 */
export async function handleCreateActionRequest(
	deps: HandlerDeps,
	args: CreateActionArgs,
	originator: string,
): Promise<CreateActionArgs> {
	const p1satIntent = parseIntentLabel(args.labels)
	const admin = isAdmin(deps, originator)

	if (!admin) {
		const enriched = await enrichIntent(deps.wallet, args)

		const approved = await deps.promptHandler({
			kind: 'transaction',
			originator,
			intent: {
				kind: enriched.kind,
				p1satIntent: enriched.p1satIntent,
				inputs: enriched.inputs,
				outputs: enriched.outputs.map((o) => ({
					index: o.index,
					satoshis: o.satoshis,
					basket: o.basket,
					tags: o.tags,
					recipient: o.recipient,
					listingPriceSats: o.listingPriceSats,
					listingSeller: o.listingSeller,
					lockUntilHeight: o.lockUntilHeight,
				})),
				contentUrls: buildContentUrlMap(enriched),
				chain: enriched.chain,
				...(enriched.trust && { trust: enriched.trust }),
				// Resolves once a service answers. The card renders immediately
				// with `trust.state === 'unverified'` and upgrades in place — a
				// slow or unreachable overlay delays the badge, never the prompt.
				...(enriched.trust && {
					verification: verifyIntent(
						deps.services,
						enriched.p1satIntent,
						enriched.inputs,
						enriched.outputs,
						enriched.contentUrlForOrigin,
					),
				}),
				...(enriched.indexerFeeSats != null && {
					indexerFeeSats: enriched.indexerFeeSats,
					indexerFeeNote: enriched.indexerFeeNote,
				}),
			},
			summary: enriched.summary,
		})
		if (!approved) {
			throw new Error('1Sat permission module: user rejected the transaction.')
		}
	}

	// Admin and dApp both apply — seal ops must not bare-return on admin.
	await applyCreateAction(deps.wallet, args, p1satIntent)
	return args
}

/**
 * Pre-resolve content URLs for each asset that carries an `origin:` tag,
 * so the UI doesn't need to know how to construct ORDFS URLs.
 *
 * Map is keyed by origin value. Both labeled inputs (transfer, list,
 * cancel-listing) and basket-bound outputs (purchase incoming ordinal,
 * other "asset received into wallet" flows) get resolved.
 */
function buildContentUrlMap(
	enriched: ReturnType<typeof enrichIntent> extends Promise<infer T>
		? T
		: never,
): Record<string, string> {
	const out: Record<string, string> = {}
	const addOrigin = (tags: string[]): void => {
		const tag = tags.find((t) => t.startsWith('origin:'))
		if (!tag) return
		const value = tag.slice('origin:'.length)
		if (!value || out[value]) return
		out[value] = enriched.contentUrlForOrigin(value)
	}
	const addIcon = (tags: string[]): void => {
		const icon = tags.find((t) => t.startsWith('icon:'))?.slice(5)
		if (!icon || out[icon]) return
		if (icon.startsWith('_')) {
			const bsv21 = tags.find(
				(t) => t.startsWith('bsv21:') && t !== 'bsv21:deploy',
			)
			if (bsv21) {
				const tokenId = bsv21.slice(6)
				const txid = tokenId.split('_')[0]
				const full = `${txid}${icon}`
				out[icon] = enriched.contentUrlForOrigin(full)
				out[full] = out[icon]
				return
			}
		}
		if (icon.includes('.') || icon.includes('_')) {
			out[icon] = enriched.contentUrlForOrigin(icon.replace('_', '.'))
		}
	}
	for (const asset of enriched.inputs) {
		addOrigin(asset.tags)
		addIcon(asset.tags)
	}
	for (const output of enriched.outputs) {
		addOrigin(output.tags)
		addIcon(output.tags)
	}
	return out
}

/**
 * createAction onResponse:
 *   Extract the signable transaction's hashOutputs and authorized outpoint
 *   set, store under (originator, reference).
 *
 *   Admin-originator calls return without capturing — admin operations
 *   don't need commitment binding because subsequent createSignature calls
 *   will also auto-grant.
 */
export async function handleCreateActionResponse(
	deps: HandlerDeps,
	res: CreateActionResult,
	originator: string,
): Promise<CreateActionResult> {
	if (isAdmin(deps, originator)) return res
	const signable = res.signableTransaction
	if (!signable?.tx || !signable.reference) return res

	const tx = Transaction.fromAtomicBEEF(signable.tx)
	const hashOutputs = computeHashOutputs(tx)
	const authorizedOutpoints = new Set<string>()
	for (const inp of tx.inputs) {
		const txid = inp.sourceTXID ?? inp.sourceTransaction?.id('hex')
		if (!txid) continue
		authorizedOutpoints.add(`${txid}.${inp.sourceOutputIndex}`)
	}

	deps.cache.put(originator, {
		hashOutputs,
		authorizedOutpoints,
		approvedAt: Date.now(),
		reference: signable.reference,
	})

	return res
}

/**
 * createSignature onRequest:
 *   1. Admin → auto-grant.
 *   2. If args.data is a BIP-143 preimage and its hashOutputs +
 *      outpoint match a captured commitment → auto-grant.
 *   3. Else prompt with sighash-decoded context.
 */
export async function handleCreateSignatureRequest(
	deps: HandlerDeps,
	args: CreateSignatureArgs,
	originator: string,
): Promise<CreateSignatureArgs> {
	if (isAdmin(deps, originator)) return args

	// `args.data` carries the full BIP-143 preimage when the caller is
	// signing a tx input (signP2PKHInput passes both `data: preimage` and
	// `hashToDirectlySign: sha256(sha256(preimage))`). Prefer `data` so we
	// can parse hashOutputs + outpoint and verify against the commitment;
	// fall back to `hashToDirectlySign` only when `data` is absent.
	const preimage = args.data ?? args.hashToDirectlySign
	if (preimage && preimage.length >= MIN_BIP143_PREIMAGE_BYTES) {
		const parsed = parsePreimage(preimage)
		if (parsed) {
			const commitment = deps.cache.findByHashOutputs(
				originator,
				parsed.hashOutputs,
			)
			if (commitment?.authorizedOutpoints.has(parsed.outpoint)) {
				return args
			}
			if (commitment) {
				throw new Error(
					`1Sat permission module: signature requested for outpoint ${parsed.outpoint} which was not part of the approved transaction.`,
				)
			}
		}
	}

	const approved = await deps.promptHandler({
		kind: 'signature',
		originator,
		intent: {
			protocolID: args.protocolID,
			keyID: args.keyID,
			counterparty: args.counterparty,
			dataLength: preimage?.length ?? 0,
		},
		summary: 'Sign payload',
	})
	if (!approved) {
		throw new Error('1Sat permission module: user rejected the signature.')
	}
	return args
}

/**
 * getPublicKey onRequest:
 *   Pass through unconditionally. P1SAT_PROTOCOL is security level 0 —
 *   public-key revelation is the open default per BRC-100. Public keys
 *   are not signing authority; the signing oracle is gated at
 *   createAction (rich intent prompt + hashOutputs commitment) and
 *   createSignature (commitment verify or prompt). The connect dialog
 *   already discloses address-derivation access at the wallet level.
 */
export async function handleGetPublicKeyRequest(
	_deps: HandlerDeps,
	args: GetPublicKeyArgs,
	_originator: string,
): Promise<GetPublicKeyArgs> {
	return args
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isAdmin(deps: HandlerDeps, originator: string): boolean {
	return !!deps.adminOriginator && originator === deps.adminOriginator
}

// ---------------------------------------------------------------------------
// Basket-access gating
// ---------------------------------------------------------------------------

/**
 * Decide whether the originator has access to every P-prefixed `1Sat` basket
 * touched by this request. Used by both `listOutputs` and `internalizeAction`
 * — they're the two methods WPM delegates to the 1Sat module for P-baskets.
 *
 * Admin originator bypasses (same convention as
 * `WalletPermissionsManager.isAdminOriginator` → `ensureBasketAccess`
 * short-circuit).
 *
 * Baskets that already have a stored grant pass silently. Any remaining
 * baskets are surfaced as a single `'basketAccess'` prompt with the full
 * un-granted list; on approval the module persists each grant.
 *
 * Without a `permissionStore` configured we prompt every time — caching only
 * happens when the caller wired in the store.
 */
export async function ensureBasketAccess(
	deps: HandlerDeps,
	originator: string,
	baskets: Iterable<string>,
): Promise<void> {
	if (deps.adminOriginator && originator === deps.adminOriginator) return

	const unique = new Set<string>()
	for (const b of baskets) {
		if (typeof b === 'string' && b.startsWith(P1SAT_BASKET_PREFIX))
			unique.add(b)
	}
	if (unique.size === 0) return

	const toPrompt: string[] = []
	if (deps.permissionStore) {
		for (const basket of unique) {
			const grant = await deps.permissionStore.findGrant({
				type: 'basket',
				originator,
				basket,
			})
			if (!grant || isGrantExpired(grant.expiry)) {
				toPrompt.push(basket)
			}
		}
	} else {
		toPrompt.push(...unique)
	}

	if (toPrompt.length === 0) return

	const approved = await deps.promptHandler({
		kind: 'basketAccess',
		originator,
		intent: {
			baskets: toPrompt.map((basket) => ({ basket })),
		},
		summary:
			toPrompt.length === 1
				? `Grant access to ${toPrompt[0]}`
				: `Grant access to ${toPrompt.length} baskets`,
	})
	if (!approved) {
		throw new Error(
			`1Sat permission module: user denied basket access (${toPrompt.join(', ')}).`,
		)
	}

	if (deps.permissionStore) {
		const now = Date.now()
		for (const basket of toPrompt) {
			await deps.permissionStore.putGrant({
				key: { type: 'basket', originator, basket },
				expiry: 0,
				grantedAt: now,
			})
		}
	}
}

function isGrantExpired(expiry: number): boolean {
	if (!expiry) return false
	return expiry < Math.floor(Date.now() / 1000)
}

/**
 * listOutputs onRequest: gate basket access then pass args through unchanged.
 */
export async function handleListOutputsRequest(
	deps: HandlerDeps,
	args: ListOutputsArgs,
	originator: string,
): Promise<ListOutputsArgs> {
	await ensureBasketAccess(deps, originator, args.basket ? [args.basket] : [])
	return args
}

/**
 * internalizeAction onRequest: gate basket access for every output's
 * insertionRemittance basket then pass args through unchanged.
 */
export async function handleInternalizeActionRequest(
	deps: HandlerDeps,
	args: InternalizeActionArgs,
	originator: string,
): Promise<InternalizeActionArgs> {
	const baskets: string[] = []
	for (const out of args.outputs ?? []) {
		if (
			out.protocol === 'basket insertion' &&
			out.insertionRemittance?.basket
		) {
			baskets.push(out.insertionRemittance.basket)
		}
	}
	await ensureBasketAccess(deps, originator, baskets)
	return args
}
