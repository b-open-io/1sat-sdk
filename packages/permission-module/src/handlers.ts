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
 *   3. Prompt user with structured intent. Reject throws.
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

	const summary = summarizeIntent(args)
	const approved = await deps.promptHandler({
		kind: 'transaction',
		originator,
		intent: {
			description: args.description,
			inputs: args.inputs?.map(stripInputForPrompt) ?? [],
			outputs: outputs.map(stripOutputForPrompt),
			labels: args.labels ?? [],
		},
		summary,
	})
	if (!approved) {
		throw new Error('1Sat permission module: user rejected the transaction.')
	}

	return { ...args, outputs }
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

	const data = args.hashToDirectlySign ?? args.data
	if (data && data.length >= MIN_BIP143_PREIMAGE_BYTES) {
		const parsed = parsePreimage(data)
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
			dataLength: data?.length ?? 0,
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
 *   Admin → allow. External → reject. There is no use case where an
 *   external dApp needs a derived pubkey under the 'p 1sat' protocol
 *   on the user's wallet (BRC-29 sender derivation is done locally by
 *   the sender from the recipient's identity key). Rejecting closes
 *   the surface entirely.
 */
export function handleGetPublicKeyRequest(
	deps: HandlerDeps,
	args: GetPublicKeyArgs,
	originator: string,
): GetPublicKeyArgs {
	if (isAdmin(deps, originator)) return args
	throw new Error(
		"1Sat permission module: getPublicKey under 'p 1sat' is not available to external originators.",
	)
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
