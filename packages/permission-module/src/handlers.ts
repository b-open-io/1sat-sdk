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
import { P1SAT_PROTOCOL } from '@1sat/types'
import {
	type IPermissionStore,
	normalizeOriginator,
	type PermissionKey,
} from '@1sat/wallet'
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
	permissionStore?: IPermissionStore
	/**
	 * Coalesces concurrent protocol-access prompts for the same originator.
	 * deriveDepositAddresses typically issues N parallel getPublicKey calls
	 * (one per derivation index) — without coalescing the user sees N
	 * prompts. With it: the first call opens the prompt, the rest await
	 * the same Promise.
	 */
	pendingProtocolGrants: Map<string, Promise<boolean>>
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
 *   Admin → allow. External → check the persisted protocol grant; if
 *   present, allow silently. If not, prompt the user with a `'protocol'`
 *   request describing read-only address access — on approve, persist
 *   the grant so subsequent calls are silent.
 *
 *   The grant is read-only: it covers `getPublicKey` only. Signing
 *   (createAction/createSignature) is gated separately, per-operation.
 */
export async function handleGetPublicKeyRequest(
	deps: HandlerDeps,
	args: GetPublicKeyArgs,
	originator: string,
): Promise<GetPublicKeyArgs> {
	if (isAdmin(deps, originator)) return args

	// Normalize the originator the same way LocalWalletPermissionsManager
	// does so the grant we write lands in the same key bucket the wallet's
	// existing `listProtocolPermissions` / revoke flows query.
	const normalized = normalizeOriginator(originator)
	const grantKey = buildProtocolGrantKey(normalized)

	if (deps.permissionStore) {
		const existing = await deps.permissionStore.findGrant(grantKey)
		if (existing && !isExpired(existing.expiry)) return args
	}

	// Coalesce concurrent prompts for the same originator. The first call
	// opens the prompt; any other getPublicKey requests that arrive while
	// it's pending await the same Promise instead of opening duplicates.
	let pending = deps.pendingProtocolGrants.get(originator)
	if (!pending) {
		pending = (async () => {
			try {
				const approved = await deps.promptHandler({
					kind: 'protocol',
					originator,
					intent: {
						protocolID: P1SAT_PROTOCOL,
						counterparty: 'self',
						access: 'read-only',
						notes:
							'Allows the app to derive your 1Sat addresses for receiving funds. Signing is approved separately for each transaction.',
					},
					summary: 'Allow read-only 1Sat protocol access (address derivation)',
				})
				if (approved && deps.permissionStore) {
					await deps.permissionStore.putGrant({
						key: grantKey,
						expiry: 0,
						grantedAt: Date.now(),
						reason: '1Sat read-only protocol access',
					})
				}
				return approved
			} finally {
				deps.pendingProtocolGrants.delete(originator)
			}
		})()
		deps.pendingProtocolGrants.set(originator, pending)
	}

	const approved = await pending
	if (!approved) {
		throw new Error('1Sat permission module: user rejected protocol access.')
	}
	return args
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isAdmin(deps: HandlerDeps, originator: string): boolean {
	return !!deps.adminOriginator && originator === deps.adminOriginator
}

function buildProtocolGrantKey(normalizedOriginator: string): PermissionKey {
	return {
		type: 'protocol',
		originator: normalizedOriginator,
		privileged: false,
		protocolLevel: P1SAT_PROTOCOL[0],
		protocolName: P1SAT_PROTOCOL[1],
		counterparty: 'self',
	}
}

function isExpired(expiry: number): boolean {
	if (expiry === 0) return false
	return Math.floor(Date.now() / 1000) > expiry
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
