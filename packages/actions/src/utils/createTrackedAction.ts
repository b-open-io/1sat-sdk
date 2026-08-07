import { P1SAT_LABEL, ensureP1SatActionLabel } from '@1sat/types'
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
 * Generate a random hex string for action tracking (64 bits).
 */
export function randomActionId(): string {
	const bytes = new Uint8Array(8)
	crypto.getRandomValues(bytes)
	return Utils.toHex(Array.from(bytes))
}

/** Recover action id from existing `id:<actionId>_<index>` tags, if any. */
function actionIdFromOutputTags(args: CreateActionArgs): string | undefined {
	const ids = new Set<string>()
	for (const output of args.outputs ?? []) {
		for (const tag of output.tags ?? []) {
			if (!tag.startsWith('id:')) continue
			const rest = tag.slice(3)
			const us = rest.lastIndexOf('_')
			if (us <= 0) continue
			const id = rest.slice(0, us)
			const index = rest.slice(us + 1)
			if (id && /^\d+$/.test(index)) ids.add(id)
		}
	}
	if (ids.size === 0) return undefined
	if (ids.size > 1) {
		throw new Error(
			`P1Sat outputs carry more than one action id in id: tags (${[...ids].join(', ')})`,
		)
	}
	return [...ids][0]
}

/**
 * Ensure basketed outputs have `id:<actionId>_<index>` tags and args carry
 * the bare `p 1sat action` dispatch label.
 *
 * Action id is SDK-internal (tags), not part of the label. Reuses an id
 * already present on tags when apply/prepare runs twice on the same args.
 */
export function ensureActionId(args: CreateActionArgs): string {
	const existing = actionIdFromOutputTags(args)
	const actionId = existing ?? randomActionId()
	if (args.outputs) {
		for (const [i, output] of args.outputs.entries()) {
			if (!output.basket) continue
			const tag = `id:${actionId}_${i}`
			const tags = (output.tags ?? []).filter((t) => !t.startsWith('id:'))
			output.tags = [...tags, tag]
		}
	}
	args.labels = ensureP1SatActionLabel(args.labels)
	if (!args.labels.includes(P1SAT_LABEL)) {
		args.labels = [...args.labels, P1SAT_LABEL]
	}
	return actionId
}

/**
 * Options shared by `createTrackedAction` / `executeTrackedAction`.
 */
export interface TrackedActionOptions {
	/**
	 * When true, skip the `p 1sat action` label and per-output `id:` tags.
	 * Use for internal plumbing (e.g. Sigma anchor).
	 */
	bypassP1Sat?: boolean
}

/**
 * Wrapper around wallet.createAction that injects per-output `id:` tags
 * and a `p 1sat action` dispatch label for the 1Sat permission module.
 */
export async function createTrackedAction(
	wallet: WalletInterface,
	args: CreateActionArgs,
	opts: TrackedActionOptions = {},
): Promise<CreateActionResult & { actionId: string }> {
	const actionId = opts.bypassP1Sat ? randomActionId() : ensureActionId(args)

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
		const actionId = opts.bypassP1Sat ? randomActionId() : ensureActionId(args)

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
