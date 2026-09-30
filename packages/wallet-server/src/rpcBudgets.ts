import { WERR_INVALID_PARAMETER } from '@bsv/wallet-toolbox/out/src/sdk'

/**
 * Request limits applied before dispatch, matching wallet-toolbox
 * StorageServer's `enforceRpcRequestBudgets` with its "standard" profile,
 * except the list limit, which allows BRC-100's maximum of 10,000.
 */
export interface RpcBudgets {
	defaultListLimit: number
	maxListLimit: number
	maxListOffset: number
	maxArrayItems: number
	maxResponseBytes: number
}

export const DEFAULT_RPC_BUDGETS: RpcBudgets = {
	defaultListLimit: 1_000,
	maxListLimit: 10_000,
	maxListOffset: 1_000_000,
	maxArrayItems: 1_000_000,
	maxResponseBytes: 8 * 1024 * 1024,
}

/** Methods whose args object at this index carries `limit` / `offset`. */
const TOP_LEVEL_LIMIT_ARGUMENT = new Map<string, number>([
	['listActions', 1],
	['listCertificates', 1],
	['listOutputs', 1],
])

/** Methods whose args object at this index carries `paged.limit` / `paged.offset`. */
const PAGED_LIMIT_ARGUMENT = new Map<string, number>([
	['findCertificatesAuth', 1],
	['findOutputBaskets', 1],
	['findOutputBasketsAuth', 1],
	['findOutputsAuth', 1],
	['findProvenTxReqs', 0],
])

const MAX_NESTING = 64

export function enforceRpcBudgets(
	method: string,
	params: unknown[],
	budgets: RpcBudgets = DEFAULT_RPC_BUDGETS,
): void {
	enforceArrayBudget(params, budgets.maxArrayItems)

	const topLevel = TOP_LEVEL_LIMIT_ARGUMENT.get(method)
	if (topLevel != null) {
		const args = objectArgument(params, topLevel)
		args.limit = normalizedLimit(args.limit, budgets)
		args.offset = normalizedOffset(args.offset, budgets)
	}

	const pagedIndex = PAGED_LIMIT_ARGUMENT.get(method)
	if (pagedIndex != null) {
		const args = objectArgument(params, pagedIndex)
		const paged = (args.paged ?? {}) as Record<string, unknown>
		if (typeof paged !== 'object' || Array.isArray(paged)) {
			throw new WERR_INVALID_PARAMETER('paged', 'an object')
		}
		paged.limit = normalizedLimit(paged.limit, budgets)
		paged.offset = normalizedOffset(paged.offset, budgets)
		args.paged = paged
	}

	if (method === 'getSyncChunk' || method === 'processSyncChunk') {
		const args = objectArgument(params, 0)
		if (args.offsets != null) {
			if (!Array.isArray(args.offsets)) {
				throw new WERR_INVALID_PARAMETER('offsets', 'an array')
			}
			for (const entry of args.offsets as unknown[]) {
				if (
					entry == null ||
					typeof entry !== 'object' ||
					Array.isArray(entry)
				) {
					throw new WERR_INVALID_PARAMETER('offsets', 'an array of objects')
				}
				const e = entry as Record<string, unknown>
				e.offset = normalizedOffset(e.offset, budgets)
			}
		}
	}

	if (method === 'getSyncChunk') {
		const args = objectArgument(params, 0)
		args.maxItems = normalizedLimit(args.maxItems, budgets)
		if (
			!Number.isSafeInteger(args.maxRoughSize) ||
			(args.maxRoughSize as number) > budgets.maxResponseBytes
		) {
			args.maxRoughSize = budgets.maxResponseBytes
		}
	}
}

function objectArgument(
	params: unknown[],
	index: number,
): Record<string, unknown> {
	const value = params[index]
	if (value == null) {
		const created: Record<string, unknown> = {}
		params[index] = created
		return created
	}
	if (typeof value !== 'object' || Array.isArray(value)) {
		throw new WERR_INVALID_PARAMETER(`params[${index}]`, 'an object')
	}
	return value as Record<string, unknown>
}

function normalizedLimit(value: unknown, budgets: RpcBudgets): number {
	if (value == null) return budgets.defaultListLimit
	if (!Number.isSafeInteger(value) || (value as number) < 1) {
		throw new WERR_INVALID_PARAMETER('limit', 'a positive safe integer')
	}
	if ((value as number) > budgets.maxListLimit) {
		throw new WERR_INVALID_PARAMETER(
			'limit',
			`no greater than ${budgets.maxListLimit}`,
		)
	}
	return value as number
}

function normalizedOffset(value: unknown, budgets: RpcBudgets): number {
	if (value == null) return 0
	if (!Number.isSafeInteger(value) || (value as number) < 0) {
		throw new WERR_INVALID_PARAMETER('offset', 'a non-negative safe integer')
	}
	if ((value as number) > budgets.maxListOffset) {
		throw new WERR_INVALID_PARAMETER(
			'offset',
			`no greater than ${budgets.maxListOffset}`,
		)
	}
	return value as number
}

/**
 * Bounds array cardinality and nesting. Byte arrays (JSON number arrays and
 * Uint8Array) are skipped: the HTTP body limit bounds them, as upstream does
 * for decoded binary values.
 */
function enforceArrayBudget(params: unknown[], maxArrayItems: number): void {
	const pending: { value: unknown; depth: number }[] = [
		{ value: params, depth: 0 },
	]
	const seen = new Set<object>()
	while (pending.length > 0) {
		const current = pending.pop() as { value: unknown; depth: number }
		if (current.depth > MAX_NESTING) {
			throw new WERR_INVALID_PARAMETER(
				'params',
				`nested no deeper than ${MAX_NESTING} levels`,
			)
		}
		const value = current.value
		if (value == null || typeof value !== 'object') continue
		if (value instanceof Uint8Array || seen.has(value)) continue
		seen.add(value)
		if (Array.isArray(value)) {
			if (typeof value[0] === 'number') continue
			if (value.length > maxArrayItems) {
				throw new WERR_INVALID_PARAMETER(
					'params',
					`arrays of no more than ${maxArrayItems} items`,
				)
			}
		}
		for (const child of Object.values(value)) {
			pending.push({ value: child, depth: current.depth + 1 })
		}
	}
}
