import {
	PERMISSION_SCHEMES,
	type PermissionSchemeId,
	ensureSchemeActionLabel,
} from '@1sat/types'
import {
	type CreateActionArgs,
	type CreateActionResult,
	Utils,
	type WalletInterface,
} from '@bsv/sdk'
import { applyP1SatCreateAction } from '../apply/applyIntent'
import type { FundingProvider } from '../funding'
import { runCreateActionPipeline } from '../pipeline/runPipeline'
import type { Spend } from '../pipeline/spendTargets'
import { labelsFromSpends, spendsFromLabels } from '../pipeline/spendTargets'
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
 * Stamp `id:<actionId>_<index>` on every basketed output. No module labels.
 */
export function stampManagedOutputIds(args: CreateActionArgs): string {
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
	return actionId
}

/**
 * Opt-in: add `p <scheme> action` so WPM routes createAction to that scheme's module.
 */
export function ensureSchemeDispatchLabel(
	args: CreateActionArgs,
	scheme: PermissionSchemeId,
): void {
	args.labels = ensureSchemeActionLabel(args.labels, scheme)
}

/** @deprecated Prefer {@link ensureSchemeDispatchLabel}. */
export function ensureP1SatDispatchLabel(args: CreateActionArgs): void {
	ensureSchemeDispatchLabel(args, PERMISSION_SCHEMES.ONESAT)
}

/**
 * @deprecated Prefer stampManagedOutputIds + optional ensureSchemeDispatchLabel.
 */
export function ensureActionId(args: CreateActionArgs): string {
	const actionId = stampManagedOutputIds(args)
	ensureSchemeDispatchLabel(args, PERMISSION_SCHEMES.ONESAT)
	return actionId
}

export interface TrackedActionOptions {
	/**
	 * When true, skip managed id tags and module dispatch labels.
	 * Use for internal plumbing (e.g. Sigma anchor).
	 */
	bypassP1Sat?: boolean
	/**
	 * Opt-in permission module. Default false (local shared pipeline).
	 * When true: stamp scheme dispatch + input labels; module runs pipeline after approve.
	 */
	usePermissionModule?: boolean
	/** @deprecated use usePermissionModule */
	useOneSatModule?: boolean
	/** @deprecated use usePermissionModule */
	useModule?: boolean
	/**
	 * Which BRC-99 scheme to route when usePermissionModule is true.
	 * Default `1sat` (collectables).
	 */
	permissionScheme?: PermissionSchemeId
	/**
	 * Inputs the pipeline must unlock.
	 * Local: pass outpoint+CI when already loaded; basket+id loads if CI missing.
	 * Module: encoded as `p <scheme> input` labels; base wallet materializes.
	 */
	spends?: Spend[]
	/** @deprecated use spends */
	spendTargets?: Spend[]
}

function wantsPermissionModule(opts: TrackedActionOptions): boolean {
	return !!(opts.usePermissionModule ?? opts.useOneSatModule ?? opts.useModule)
}

function permissionSchemeOf(opts: TrackedActionOptions): PermissionSchemeId {
	return opts.permissionScheme ?? PERMISSION_SCHEMES.ONESAT
}

/**
 * @deprecated Prefer runCreateActionPipeline / executeTrackedAction with spends.
 */
export async function createTrackedAction(
	wallet: WalletInterface,
	args: CreateActionArgs,
	opts: TrackedActionOptions = {},
): Promise<CreateActionResult & { actionId: string }> {
	const actionId = opts.bypassP1Sat
		? randomActionId()
		: stampManagedOutputIds(args)
	const spends = opts.spends ?? opts.spendTargets ?? []
	if (!opts.bypassP1Sat && wantsPermissionModule(opts)) {
		ensureSchemeDispatchLabel(args, permissionSchemeOf(opts))
		if (spends.length) {
			const extra = labelsFromSpends(spends)
			args.labels = [...(args.labels ?? []), ...extra]
		}
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
 * - fundingProvider: seals then fund + internalize (side door)
 * - usePermissionModule: labels + createAction (module finishes pipeline)
 * - local default: shared runCreateActionPipeline
 * - legacy sign callback still honored when provided without spends
 */
export async function executeTrackedAction(
	wallet: WalletInterface,
	args: CreateActionArgs,
	fundingProvider?: FundingProvider,
	inputBEEF?: number[],
	sign?: SigningCallback,
	opts: TrackedActionOptions = {},
): Promise<CompleteSignedActionResult & { actionId: string }> {
	const useModule = wantsPermissionModule(opts)
	const scheme = permissionSchemeOf(opts)
	const spends =
		opts.spends ?? opts.spendTargets ?? spendsFromLabels(args.labels)

	if (fundingProvider) {
		const actionId = opts.bypassP1Sat
			? randomActionId()
			: await applyP1SatCreateAction(wallet, args)
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

	if (opts.bypassP1Sat) {
		const actionId = randomActionId()
		const { options, ...rest } = args
		const createResult = await wallet.createAction({
			...rest,
			options: { ...options, signAndProcess: false },
		})
		if (!createResult.signableTransaction) {
			return {
				txid: createResult.txid,
				tx: createResult.tx ? Array.from(createResult.tx) : undefined,
				noSendChange: createResult.noSendChange,
				actionId,
			}
		}
		const result = await completeSignedAction(
			wallet,
			createResult,
			inputBEEF,
			sign ?? noOpSign,
		)
		return { ...result, actionId }
	}

	if (useModule) {
		ensureSchemeDispatchLabel(args, scheme)
		if (spends.length) {
			const extra = labelsFromSpends(spends)
			const have = new Set(args.labels ?? [])
			args.labels = [
				...(args.labels ?? []),
				...extra.filter((l) => !have.has(l)),
			]
		}
		const { options, ...rest } = args
		const createResult = await wallet.createAction({
			...rest,
			options: { ...options, signAndProcess: false },
		})
		const actionId = actionIdFromOutputTags(args) ?? randomActionId()
		if (!createResult.signableTransaction) {
			return {
				txid: createResult.txid,
				tx: createResult.tx ? Array.from(createResult.tx) : undefined,
				noSendChange: createResult.noSendChange,
				actionId,
			}
		}
		return {
			error: 'module-left-signable-transaction',
			actionId,
		}
	}

	// Local shared pipeline
	if (sign && spends.length === 0) {
		const actionId = await applyP1SatCreateAction(wallet, args)
		const { options, ...rest } = args
		const createResult = await wallet.createAction({
			...rest,
			options: { ...options, signAndProcess: false },
		})
		if (!createResult.signableTransaction) {
			return {
				txid: createResult.txid,
				tx: createResult.tx ? Array.from(createResult.tx) : undefined,
				noSendChange: createResult.noSendChange,
				actionId,
			}
		}
		const beef =
			inputBEEF ??
			(Array.isArray(args.inputBEEF) ? (args.inputBEEF as number[]) : undefined)
		const result = await completeSignedAction(wallet, createResult, beef, sign)
		return { ...result, actionId }
	}

	return runCreateActionPipeline(wallet, args, spends, { inputBEEF })
}
