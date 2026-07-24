import { P1SAT_LABEL } from '@1sat/types'
import {
	type CreateActionArgs,
	type CreateActionResult,
	Utils,
	type WalletInterface,
} from '@bsv/sdk'
import type { FundingProvider } from '../funding'
import {
	type CompleteSignedActionResult,
	type SigningCallback,
	completeSignedAction,
} from './completeSignedAction'

/**
 * Generate a random hex string for action tracking.
 */
export function randomActionId(): string {
	const bytes = new Uint8Array(8)
	crypto.getRandomValues(bytes)
	return Utils.toHex(Array.from(bytes))
}

/**
 * Inject tracking tags into outputs that have baskets.
 *
 * Each basketed output gets `id:<actionId>_<argsIndex>` — unique per
 * output. The original "all outputs share one id" scheme made
 * targeted lookups ambiguous when an action created multiple outputs;
 * per-output ids make `listOutputs(basket, tags:[id:<value>])` resolve
 * to exactly one record. Existing readers (loadBasketOutput, identity
 * getProfile, the 1Sat permission module's lookup) all want this.
 */
function applyTrackingTags(args: CreateActionArgs, actionId: string): void {
	if (!args.outputs) return
	args.outputs.forEach((output, i) => {
		if (output.basket) {
			output.tags = [...(output.tags ?? []), `id:${actionId}_${i}`]
		}
	})
}

/**
 * Ensure the args carry the `'p 1sat'` label so WalletPermissionsManager
 * dispatches the createAction call to the registered 1Sat permission
 * module. Without this label, the module never sees createAction and
 * subsequent createSignature calls under `'p 1sat'` arrive with no
 * captured commitment — which would prompt the user once per input.
 */
function applyOneSatLabel(args: CreateActionArgs): void {
	const labels = args.labels ?? []
	if (labels.includes(P1SAT_LABEL)) return
	args.labels = [...labels, P1SAT_LABEL]
}

/**
 * Options shared by `createTrackedAction` / `executeTrackedAction`.
 */
export interface TrackedActionOptions {
	/**
	 * When true, skip the `'p 1sat action'` dispatch label and the
	 * per-output `id:` tracking tags. Use for internal plumbing actions
	 * that should not surface through the 1Sat permission module
	 * (e.g. the Sigma anchor output created inside the inscribe flow —
	 * a 2-sat lock-in that exists only so the inscription tx can spend
	 * it to produce a Sigma signature).
	 */
	bypassP1Sat?: boolean
}

/**
 * Wrapper around wallet.createAction that injects per-output `id:` tags
 * and the `'p 1sat action'` dispatch label for the 1Sat permission module.
 *
 * Only calls createAction(signAndProcess: false). Does NOT call signAction.
 * All signAction calls go through completeSignedAction for abort protection.
 *
 * @param wallet - BRC-100 wallet
 * @param args - Standard createAction args
 * @param opts - Tracked-action options (e.g. `bypassP1Sat`)
 * @returns The createAction result with signableTransaction, plus the generated actionId
 */
export async function createTrackedAction(
	wallet: WalletInterface,
	args: CreateActionArgs,
	opts: TrackedActionOptions = {},
): Promise<CreateActionResult & { actionId: string }> {
	const actionId = randomActionId()
	if (!opts.bypassP1Sat) {
		applyTrackingTags(args, actionId)
		applyOneSatLabel(args)
	}

	const { options, ...rest } = args
	const createResult = await wallet.createAction({
		...rest,
		options: {
			...options,
			signAndProcess: false,
		},
	})

	return { ...createResult, actionId }
}

const noOpSign: SigningCallback = async () => ({})

/**
 * Execute a tracked action end-to-end.
 *
 * If a fundingProvider is supplied, the provider builds, funds, and broadcasts
 * the transaction externally. The result is then internalized into the wallet.
 *
 * Otherwise, creates the action via createTrackedAction then completes it
 * via completeSignedAction (which handles signing, script verification,
 * signAction, and abort on failure).
 *
 * @param wallet - BRC-100 wallet
 * @param args - Standard createAction args
 * @param fundingProvider - Optional external funder
 * @param inputBEEF - Optional BEEF for external inputs (merged with signable BEEF for verification)
 * @param sign - Optional signing callback for caller-signed inputs. When omitted, no external spends are provided.
 * @returns The action result, plus the generated actionId
 */
export async function executeTrackedAction(
	wallet: WalletInterface,
	args: CreateActionArgs,
	fundingProvider?: FundingProvider,
	inputBEEF?: number[],
	sign?: SigningCallback,
	opts: TrackedActionOptions = {},
): Promise<CompleteSignedActionResult & { actionId: string }> {
	if (fundingProvider) {
		const actionId = randomActionId()
		if (!opts.bypassP1Sat) {
			applyTrackingTags(args, actionId)
			applyOneSatLabel(args)
		}

		const funded = await fundingProvider.fund(args)

		const internalizeOutputs = (args.outputs ?? []).map((o, i) => ({
			outputIndex: i,
			protocol: 'basket insertion' as const,
			insertionRemittance: {
				basket: o.basket ?? 'default',
				customInstructions: o.customInstructions,
				tags: o.tags ?? [],
			},
		}))

		await wallet.internalizeAction({
			tx: funded.tx,
			outputs: internalizeOutputs,
			description: args.description,
			labels: args.labels,
		})

		return { txid: funded.txid, actionId }
	}

	const createResult = await createTrackedAction(wallet, args, opts)

	if (!createResult.signableTransaction) {
		return {
			txid: createResult.txid,
			tx: createResult.tx ? Array.from(createResult.tx) : undefined,
			noSendChange: createResult.noSendChange,
			actionId: createResult.actionId,
		}
	}

	const result = await completeSignedAction(
		wallet,
		createResult,
		inputBEEF,
		sign ?? noOpSign,
	)

	return { ...result, actionId: createResult.actionId }
}
