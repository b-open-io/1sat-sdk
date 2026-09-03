import {
	type PermissionSchemeId,
	buildExternalInputLabel,
	buildInputAssetLabel,
	parseOneInputLabel,
	schemeForBasket,
} from '@1sat/types'

/**
 * One input the pipeline must unlock.
 *
 * - Wallet inventory: set `basket` + `id` (and outpoint+CI if already loaded).
 * - Buy / external: set `outpoint` + `scheme` (or basket to derive scheme).
 * - Sigma (etc.): set `outpoint` + `customInstructions` after create.
 *
 * Finish only needs outpoint + optional CI. Basket+id is for load + module labels.
 */
export interface Spend {
	outpoint?: string
	customInstructions?: string
	basket?: string
	id?: string
	/** Permission scheme for external outpoint labels. */
	scheme?: PermissionSchemeId
}

/** Finish input: outpoint + optional CI (after materialize). */
export interface ResolvedSpend {
	outpoint: string
	customInstructions?: string
}

/** Module label for a spend (pointers only — never CI). */
export function spendToLabel(s: Spend): string | undefined {
	if (s.basket && s.id) return buildInputAssetLabel(s.basket, s.id)
	if (s.outpoint) {
		const scheme =
			s.scheme ?? (s.basket ? schemeForBasket(s.basket) : undefined) ?? '1sat'
		return buildExternalInputLabel(scheme, s.outpoint)
	}
	return undefined
}

export function labelsFromSpends(spends: Spend[]): string[] {
	const out: string[] = []
	const seen = new Set<string>()
	for (const s of spends) {
		const label = spendToLabel(s)
		if (!label || seen.has(label)) continue
		seen.add(label)
		out.push(label)
	}
	return out
}

/**
 * Parse `p <scheme> input …` labels into spends (module wire).
 * - `p <scheme> input id <key>` — wallet-held row
 * - `p <scheme> input <outpoint>` — external / buy
 */
export function spendsFromLabels(labels: string[] | undefined): Spend[] {
	if (!labels?.length) return []
	const out: Spend[] = []
	const seen = new Set<string>()

	for (const label of labels) {
		const parsed = parseOneInputLabel(label)
		if (!parsed) continue
		if (parsed.kind === 'outpoint') {
			const key = `op:${parsed.outpoint}`
			if (seen.has(key)) continue
			seen.add(key)
			out.push({ outpoint: parsed.outpoint, scheme: parsed.scheme })
			continue
		}
		const key = `b:${parsed.basket}:${parsed.id}`
		if (seen.has(key)) continue
		seen.add(key)
		out.push({
			basket: parsed.basket,
			id: parsed.id,
			scheme: parsed.scheme,
		})
	}

	return out
}

/** Merge by outpoint; prefer entry that has CI. */
export function mergeResolvedSpends(
	...lists: ResolvedSpend[][]
): ResolvedSpend[] {
	const map = new Map<string, ResolvedSpend>()
	for (const list of lists) {
		for (const r of list) {
			const op = normalizeOutpointDot(r.outpoint)
			const prev = map.get(op)
			if (!prev || (!prev.customInstructions && r.customInstructions)) {
				map.set(op, { ...r, outpoint: op })
			}
		}
	}
	return [...map.values()]
}

function normalizeOutpointDot(s: string): string {
	if (s.length >= 66 && s[64] === '_') return `${s.slice(0, 64)}.${s.slice(65)}`
	return s
}

/** Stash key on CreateActionArgs for records created during embellish (Sigma). */
export const PENDING_RESOLVED_SPENDS_KEY = '__pendingResolvedSpends' as const

export type ArgsWithPendingSpends = {
	[PENDING_RESOLVED_SPENDS_KEY]?: ResolvedSpend[]
}

// --- deprecated aliases (call sites migrating) ---
/** @deprecated use Spend */
export type SpendTarget = Spend
/** @deprecated use Spend */
export type BasketSpendTarget = Spend
/** @deprecated use Spend */
export type OutpointSpendTarget = Spend
/** @deprecated use labelsFromSpends */
export const labelsFromSpendTargets = labelsFromSpends
/** @deprecated use spendToLabel */
export const spendTargetToLabel = (t: Spend) => spendToLabel(t) ?? ''
/** @deprecated use spendsFromLabels */
export const spendTargetsFromLabels = spendsFromLabels
