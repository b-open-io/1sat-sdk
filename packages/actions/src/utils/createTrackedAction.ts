import {
	type CreateActionArgs,
	type CreateActionResult,
	Utils,
	type WalletInterface,
} from '@bsv/sdk'
import type { FundingProvider } from '../funding'

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
 * Wrapper around wallet.createAction that injects an `id:<hex>` tag
 * into every output that has a basket. All outputs in the same action
 * share the same ID, allowing targeted lookups via listOutputs tag filter.
 *
 * Uses two-phase flow (createAction + signAction) so the wallet's
 * permission system can intercept between creation and signing.
 *
 * @param wallet - BRC-100 wallet
 * @param args - Standard createAction args
 * @returns The createAction result, plus the generated actionId
 */
export async function createTrackedAction(
	wallet: WalletInterface,
	args: CreateActionArgs,
): Promise<CreateActionResult & { actionId: string }> {
	const actionId = randomActionId()
	applyTrackingTags(args, actionId)

	const { options, ...rest } = args
	const createResult = await wallet.createAction({
		...rest,
		options: {
			...options,
			signAndProcess: false,
		},
	})

	if (!createResult.signableTransaction) {
		return { ...createResult, actionId }
	}

	const signResult = await wallet.signAction({
		reference: createResult.signableTransaction.reference,
		spends: {},
		options: {
			acceptDelayedBroadcast: options?.acceptDelayedBroadcast ?? false,
		},
	})

	return { ...signResult, actionId }
}

/**
 * Execute a tracked action with optional external funding.
 *
 * If a fundingProvider is supplied, the full args are passed to the provider
 * to build, fund, and broadcast the transaction. The result is then
 * internalized into the wallet so it tracks the outputs.
 * Otherwise, delegates to createTrackedAction (wallet funds the transaction).
 *
 * @param wallet - BRC-100 wallet
 * @param args - Standard createAction args
 * @param fundingProvider - Optional external funder (e.g. Droplit)
 * @returns The action result, plus the generated actionId
 */
export async function executeTrackedAction(
	wallet: WalletInterface,
	args: CreateActionArgs,
	fundingProvider?: FundingProvider,
): Promise<CreateActionResult & { actionId: string }> {
	if (!fundingProvider) {
		return createTrackedAction(wallet, args)
	}

	const actionId = randomActionId()
	applyTrackingTags(args, actionId)

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
