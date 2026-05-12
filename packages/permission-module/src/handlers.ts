import type {
	CreateActionArgs,
	CreateActionInput,
	CreateActionOutput,
	CreateActionResult,
	CreateSignatureArgs,
	GetPublicKeyArgs,
	WalletInterface,
} from '@bsv/sdk'
import { Beef, Transaction } from '@bsv/sdk'
import { CommitmentCache } from './commitmentCache'
import { enrichIntent } from './enrichIntent'
import { computeHashOutputs } from './hashOutputs'
import { substitutePlaceholders } from './placeholder'
import { MIN_BIP143_PREIMAGE_BYTES, parsePreimage } from './sighashParser'
import type { PromptHandler } from './types'

interface HandlerDeps {
	wallet: WalletInterface
	promptHandler: PromptHandler
	cache: CommitmentCache
	adminOriginator?: string
}

/**
 * createAction onRequest:
 *   1. Admin originator → return args unchanged.
 *   2. Substitute placeholder markers in outputs (AIP/Sigma).
 *   3. Enrich the intent — look up input assets in the wallet by their
 *      `'p 1sat input <basket> <id>'` labels (trusted records, not dApp-supplied).
 *   4. Prompt user with the structured intent. Reject throws.
 */
export async function handleCreateActionRequest(
	deps: HandlerDeps,
	args: CreateActionArgs,
	originator: string,
): Promise<CreateActionArgs> {
	if (isAdmin(deps, originator)) return args

	let outputs = args.outputs ?? []
	if (outputs.length > 0) {
		outputs = await substitutePlaceholders(
			outputs,
			deps.wallet,
			(refVin) => resolveInputOutpoint(args.inputs ?? [], refVin),
		)
	}

	const enriched = await enrichIntent(deps.wallet, { ...args, outputs })

	const approved = await deps.promptHandler({
		kind: 'transaction',
		originator,
		intent: {
			kind: enriched.kind,
			inputs: enriched.inputs,
			outputs: enriched.outputs.map((o) => ({
				index: o.index,
				satoshis: o.satoshis,
				basket: o.basket,
				tags: o.tags,
				recipient: o.recipient,
			})),
			contentUrls: buildContentUrlMap(enriched),
			chain: enriched.chain,
		},
		summary: enriched.summary,
	})
	if (!approved) {
		throw new Error('1Sat permission module: user rejected the transaction.')
	}

	return { ...args, outputs }
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
	enriched: ReturnType<typeof enrichIntent> extends Promise<infer T> ? T : never,
): Record<string, string> {
	const out: Record<string, string> = {}
	const add = (tags: string[]): void => {
		const tag = tags.find((t) => t.startsWith('origin:'))
		if (!tag) return
		const value = tag.slice('origin:'.length)
		if (!value || out[value]) return
		out[value] = enriched.contentUrlForOrigin(value)
	}
	for (const asset of enriched.inputs) add(asset.tags)
	for (const output of enriched.outputs) add(output.tags)
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
			const commitment = deps.cache.findByHashOutputs(originator, parsed.hashOutputs)
			if (commitment && commitment.authorizedOutpoints.has(parsed.outpoint)) {
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

function resolveInputOutpoint(
	inputs: CreateActionInput[],
	refVin: number,
): { txid: string; vout: number } | null {
	const inp = inputs[refVin]
	if (!inp?.outpoint) return null
	const [txid, voutStr] = inp.outpoint.split('.')
	const vout = Number.parseInt(voutStr, 10)
	if (!txid || Number.isNaN(vout)) return null
	return { txid, vout }
}

function stripInputForPrompt(input: CreateActionInput) {
	return {
		outpoint: input.outpoint,
		inputDescription: input.inputDescription,
	}
}

function stripOutputForPrompt(output: CreateActionOutput) {
	return {
		satoshis: output.satoshis,
		outputDescription: output.outputDescription,
		basket: output.basket,
		lockingScriptLength: output.lockingScript.length / 2,
	}
}

function summarizeIntent(args: CreateActionArgs): string {
	if (args.description) return args.description
	const ins = args.inputs?.length ?? 0
	const outs = args.outputs?.length ?? 0
	return `Transaction with ${ins} input(s) and ${outs} output(s)`
}
