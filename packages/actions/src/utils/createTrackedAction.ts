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
 */
function applyTrackingTags(args: CreateActionArgs, actionId: string): void {
	const tag = `id:${actionId}`
	if (args.outputs) {
		for (const output of args.outputs) {
			if (output.basket) {
				output.tags = [...(output.tags ?? []), tag]
			}
		}
	}
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
 * Wrapper around wallet.createAction that injects an `id:<hex>` tag
 * into every output that has a basket. All outputs in the same action
 * share the same ID, allowing targeted lookups via listOutputs tag filter.
 *
 * Only calls createAction(signAndProcess: false). Does NOT call signAction.
 * All signAction calls go through completeSignedAction for abort protection.
 *
 * @param wallet - BRC-100 wallet
 * @param args - Standard createAction args
 * @returns The createAction result with signableTransaction, plus the generated actionId
 */
export async function createTrackedAction(
	wallet: WalletInterface,
	args: CreateActionArgs,
): Promise<CreateActionResult & { actionId: string }> {
	const actionId = randomActionId()
	applyTrackingTags(args, actionId)
	applyOneSatLabel(args)

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
): Promise<CompleteSignedActionResult & { actionId: string }> {
	if (fundingProvider) {
		const actionId = randomActionId()
		applyTrackingTags(args, actionId)
		applyOneSatLabel(args)

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

	const createResult = await createTrackedAction(wallet, args)

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
