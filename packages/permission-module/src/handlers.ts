import {
	type ResolvedSpend,
	embellishCreateActionArgs,
	finishCreateAction,
	spendsFromLabels,
} from '@1sat/actions'
import type { PermissionSchemeId } from '@1sat/types'
import type { IPermissionStore } from '@1sat/wallet'
import type {
	CreateActionArgs,
	CreateActionResult,
	CreateSignatureArgs,
	GetPublicKeyArgs,
	WalletInterface,
} from '@bsv/sdk'
import { Transaction } from '@bsv/sdk'
import { type TokenMetaMap, buildTransactionPrompt } from './buildPromptIntent'
import type { CommitmentCache } from './commitmentCache'
import { enrichIntent } from './enrichIntent'
import { computeHashOutputs } from './hashOutputs'
import { MIN_BIP143_PREIMAGE_BYTES, parsePreimage } from './sighashParser'
import type { PromptHandler, VerificationServices } from './types'

export {
	ensureBasketAccess,
	ensureViewScopeAccess,
	handleInternalizeActionRequest,
	handleListOutputsRequest,
} from './basketAccess'

/** Pending resolved spends between onRequest embellish and onResponse finish. */
const pendingByOriginator = new Map<
	string,
	{ resolvedSpends: ResolvedSpend[]; inputBEEF?: number[] }
>()

interface HandlerDeps {
	/** Base wallet — apply crypto never uses a gated wrapper. */
	wallet: WalletInterface
	promptHandler: PromptHandler
	cache: CommitmentCache
	/** BRC-99 scheme id this module instance owns. */
	schemeId: PermissionSchemeId
	/** Storage baskets this module may grant access to. */
	ownedBaskets: ReadonlySet<string>
	adminOriginator?: string
	permissionStore?: IPermissionStore
	services?: VerificationServices
}

/**
 * createAction onRequest:
 *   1. dApp: enrich → prompt → reject throws.
 *   2. Admin: no prompt.
 *   3. embellishCreateActionArgs = same apply as local pipeline
 *      (seals, tags, BSV-21 CI stamp) + materialize spends (plaintext CI).
 *   4. Stash spends for onResponse → finishCreateAction on base wallet.
 */
export async function handleCreateActionRequest(
	deps: HandlerDeps,
	args: CreateActionArgs,
	originator: string,
): Promise<CreateActionArgs> {
	const admin = isAdmin(deps, originator)

	if (!admin) {
		const enriched = await enrichIntent(deps.wallet, args, {
			services: deps.services,
		})

		const contentUrls = buildContentUrlMap(enriched)
		const tokenMeta = await resolveTokenMeta(
			deps.services,
			enriched,
			contentUrls,
		)
		const prompt = buildTransactionPrompt(
			enriched,
			contentUrls,
			originator,
			tokenMeta,
		)

		const approved = await deps.promptHandler({
			kind: 'transaction',
			originator,
			payload: prompt as unknown as Record<string, unknown>,
			summary: enriched.summary,
		})
		if (!approved) {
			throw new Error('1Sat permission module: user rejected the transaction.')
		}
	}

	// Same apply as local pipeline (seals, tags, BSV-21 CI stamp) + spend load.
	const spends = spendsFromLabels(args.labels)
	const { args: next, resolvedSpends } = await embellishCreateActionArgs(
		deps.wallet,
		args,
		spends,
	)
	pendingByOriginator.set(originator, {
		resolvedSpends,
		inputBEEF: Array.isArray(next.inputBEEF)
			? (next.inputBEEF as number[])
			: undefined,
	})
	return next
}

/**
 * Overlay lookup for BSV21 display facts (decimals, symbol, icon).
 * Never throws — missing overlay leaves tag/script fallbacks.
 */
async function resolveTokenMeta(
	services: VerificationServices | undefined,
	enriched: Awaited<ReturnType<typeof enrichIntent>>,
	contentUrls: Record<string, string>,
): Promise<TokenMetaMap> {
	const out: TokenMetaMap = {}
	const getDetails = services?.bsv21?.getTokenDetails
	if (typeof getDetails !== 'function') return out

	const ids = new Set<string>()
	for (const leg of enriched.legs) {
		const id =
			leg.tokenId ??
			leg.tags
				?.find((t) => t.startsWith('bsv21:') && t !== 'bsv21:deploy')
				?.slice(6)
		if (id) ids.add(id)
	}
	for (const inp of enriched.inputs) {
		const id = inp.tags
			.find((t) => t.startsWith('bsv21:') && t !== 'bsv21:deploy')
			?.slice(6)
		if (id) ids.add(id)
	}
	for (const o of enriched.outputs) {
		if (o.tokenId) ids.add(o.tokenId)
	}

	await Promise.all(
		[...ids].map(async (tokenId) => {
			try {
				const res = await getDetails(tokenId)
				if (!res?.token) return
				const decRaw = res.token.dec
				const dec =
					typeof decRaw === 'number'
						? decRaw
						: typeof decRaw === 'string'
							? Number.parseInt(decRaw, 10)
							: undefined
				const icon = res.token.icon
				let iconUrl: string | undefined
				if (icon) {
					iconUrl =
						contentUrls[icon] ??
						contentUrls[icon.replace('_', '.')] ??
						(icon.includes('.') || icon.includes('_')
							? enriched.contentUrlForOrigin(icon.replace('_', '.'))
							: undefined)
					if (iconUrl) {
						contentUrls[icon] = iconUrl
						contentUrls[icon.replace('_', '.')] = iconUrl
					}
				}
				out[tokenId] = {
					...(Number.isFinite(dec) ? { dec: dec as number } : {}),
					...(res.token.sym ? { sym: res.token.sym } : {}),
					...(icon ? { icon } : {}),
					...(iconUrl ? { iconUrl } : {}),
				}
			} catch {
				// leave empty — tag/script fallbacks apply
			}
		}),
	)
	return out
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
		// Avatar on an OpNS bind comes from the script, not a tag.
		const avatar = output.opnsAvatarOrigin
		if (avatar && !out[avatar]) {
			out[avatar] = enriched.contentUrlForOrigin(avatar.replace('_', '.'))
		}
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
	const pending = pendingByOriginator.get(originator)
	pendingByOriginator.delete(originator)

	const signable = res.signableTransaction
	if (signable?.tx && signable.reference && !isAdmin(deps, originator)) {
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
	}

	// Finish pipeline on base wallet (unlock managed spends + signAction)
	if (!signable) return res
	const finished = await finishCreateAction(
		deps.wallet,
		res,
		pending?.resolvedSpends ?? [],
		pending?.inputBEEF,
	)
	if (finished.error) {
		throw new Error(`1Sat permission module: finish failed: ${finished.error}`)
	}
	return {
		txid: finished.txid,
		tx: finished.tx,
		noSendChange: finished.noSendChange,
	} as CreateActionResult
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
		payload: {
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
 *   Pass through unconditionally. Module P-protocol is security level 0 —
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
