import type {
	CreateActionArgs,
	CreateActionResult,
	WalletInterface,
} from '@bsv/sdk'
import { applyP1SatCreateAction } from '../apply/applyIntent.js'
import {
	type CompleteSignedActionResult,
	completeSignedAction,
} from '../utils/completeSignedAction.js'
import {
	type ArgsWithPendingSpends,
	PENDING_RESOLVED_SPENDS_KEY,
	type ResolvedSpend,
	type Spend,
	mergeResolvedSpends,
} from './spendTargets.js'
import { buildSpendsForResolved, materializeSpends } from './unlockInput.js'

export interface PipelineOptions {
	/** Optional BEEF for external inputs (merged at sign). */
	inputBEEF?: number[]
}

/**
 * Shared createAction pipeline (local and module base wallet):
 * embellish → materialize spends → createAction → unlock → signAction.
 */
export async function runCreateActionPipeline(
	wallet: WalletInterface,
	args: CreateActionArgs,
	spends: Spend[] = [],
	opts: PipelineOptions = {},
): Promise<CompleteSignedActionResult & { actionId: string }> {
	const argsCopy: CreateActionArgs = {
		...args,
		outputs: args.outputs?.map((o) => ({
			...o,
			tags: o.tags ? [...o.tags] : undefined,
		})),
		inputs: args.inputs?.map((i) => ({ ...i })),
		labels: args.labels ? [...args.labels] : undefined,
		options: args.options ? { ...args.options } : undefined,
	}

	const actionId = await applyP1SatCreateAction(wallet, argsCopy)

	const records = await collectOutputRecords(wallet, argsCopy, spends)
	if ('error' in records) {
		return { error: records.error, actionId }
	}

	const { options, ...rest } = argsCopy
	const createResult = await wallet.createAction({
		...rest,
		options: {
			...options,
			signAndProcess: false,
		},
	})

	const beef =
		opts.inputBEEF ??
		(Array.isArray(argsCopy.inputBEEF)
			? (argsCopy.inputBEEF as number[])
			: undefined)

	return finishCreateAction(wallet, createResult, records, beef, actionId)
}

/**
 * After createAction: unlock from resolved records + signAction.
 */
export async function finishCreateAction(
	wallet: WalletInterface,
	createResult: CreateActionResult,
	outputRecords: ResolvedSpend[],
	inputBEEF?: number[],
	actionId?: string,
): Promise<CompleteSignedActionResult & { actionId: string }> {
	const id = actionId ?? 'unknown'

	if (!createResult.signableTransaction) {
		return {
			txid: createResult.txid,
			tx: createResult.tx ? Array.from(createResult.tx) : undefined,
			noSendChange: createResult.noSendChange,
			actionId: id,
		}
	}

	const result = await completeSignedAction(
		wallet,
		createResult,
		inputBEEF,
		async (tx) => {
			if (outputRecords.length === 0) return {}
			const unlocks = await buildSpendsForResolved(wallet, tx, outputRecords)
			if ('error' in unlocks) throw new Error(unlocks.error)
			return unlocks
		},
	)

	return { ...result, actionId: id }
}

/**
 * Embellish + materialize spends (module onRequest after approve).
 * Module always materializes basket+id from storage; never trusts dApp CI.
 */
export async function embellishCreateActionArgs(
	wallet: WalletInterface,
	args: CreateActionArgs,
	spends: Spend[] = [],
): Promise<{
	args: CreateActionArgs
	actionId: string
	resolvedSpends: ResolvedSpend[]
}> {
	const actionId = await applyP1SatCreateAction(wallet, args)

	const records = await collectOutputRecords(wallet, args, spends)
	if ('error' in records) {
		throw new Error(records.error)
	}
	return { args, actionId, resolvedSpends: records }
}

/** Pending (Sigma) + materialize caller spends → finish list. */
async function collectOutputRecords(
	wallet: WalletInterface,
	args: CreateActionArgs,
	spends: Spend[],
): Promise<ResolvedSpend[] | { error: string }> {
	const pending =
		(args as CreateActionArgs & ArgsWithPendingSpends)[
			PENDING_RESOLVED_SPENDS_KEY
		] ?? []

	const fromSpends = await materializeSpends(wallet, spends)
	if ('error' in fromSpends) return fromSpends

	return mergeResolvedSpends(pending, fromSpends)
}
