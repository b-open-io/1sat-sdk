import {
	type ScanResult,
	groupBsv20Tokens,
	isListedOutput,
} from '@1sat/actions'
import { SWEEP_CLASSES, type SweepClass } from './sweep-classes.js'

function listedCount(
	outputs: Array<{ events?: string[]; data?: Record<string, unknown> }>,
): number {
	return outputs.filter((o) => isListedOutput(o)).length
}

export type SweepPlan = {
	classes: SweepClass[]
	bsv: { count: number; sats: number }
	ordinals: { count: number; listed: number }
	opns: { count: number; listed: number }
	bsv20: Array<{
		tick: string
		amount: string
		count: number
		listed: number
	}>
	bsv21: Array<{
		tokenId: string
		symbol?: string
		amount: string
		count: number
		listed: number
		active: boolean
	}>
	leftover: {
		locked: number
		run: number
		inactiveBsv21: number
		unparsedBsv20: number
	}
}

export function buildSweepPlan(
	scan: ScanResult,
	classes: Set<SweepClass>,
): SweepPlan {
	const want = (cls: SweepClass) => classes.has(cls)
	const groupedBsv20 = groupBsv20Tokens(scan.bsv20Tokens)
	const parsedOutpoints = new Set(
		groupedBsv20.flatMap((g) => g.outputs.map((o) => o.outpoint)),
	)
	const transferableBsv21 = scan.bsv21Tokens.filter((t) => t.outputs.length > 0)
	const skippedBsv21 = scan.bsv21Tokens.filter((t) => t.outputs.length === 0)

	return {
		classes: SWEEP_CLASSES.filter((c) => classes.has(c)),
		bsv: want('bsv')
			? { count: scan.funding.length, sats: scan.totalFundingSats }
			: { count: 0, sats: 0 },
		ordinals: want('ordinals')
			? {
					count: scan.ordinals.length,
					listed: listedCount(scan.ordinals),
				}
			: { count: 0, listed: 0 },
		opns: want('opns')
			? {
					count: scan.opnsNames.length,
					listed: listedCount(scan.opnsNames),
				}
			: { count: 0, listed: 0 },
		bsv20: want('bsv20')
			? groupedBsv20.map((g) => ({
					tick: g.tick,
					amount: g.totalAmount.toString(),
					count: g.outputs.length,
					listed: listedCount(g.outputs),
				}))
			: [],
		bsv21: want('bsv21')
			? transferableBsv21.map((t) => ({
					tokenId: t.tokenId,
					symbol: t.symbol,
					amount: t.totalAmount.toString(),
					count: t.outputs.length,
					listed: listedCount(t.outputs),
					active: t.isActive,
				}))
			: [],
		leftover: {
			locked: scan.locked.length,
			run: scan.run.length,
			inactiveBsv21: skippedBsv21.reduce((n, t) => n + t.outputs.length, 0),
			unparsedBsv20: scan.bsv20Tokens.filter(
				(o) => !parsedOutpoints.has(o.outpoint),
			).length,
		},
	}
}

export function planHasWork(plan: SweepPlan): boolean {
	return (
		plan.bsv.count > 0 ||
		plan.ordinals.count > 0 ||
		plan.opns.count > 0 ||
		plan.bsv20.length > 0 ||
		plan.bsv21.length > 0
	)
}

export function describePlan(plan: SweepPlan): string[] {
	const parts: string[] = []
	if (plan.bsv.count)
		parts.push(`${plan.bsv.sats} sats (${plan.bsv.count} UTXOs)`)
	if (plan.ordinals.count) {
		const listed = plan.ordinals.listed
			? `, ${plan.ordinals.listed} listed`
			: ''
		parts.push(`${plan.ordinals.count} ordinal(s)${listed}`)
	}
	if (plan.opns.count) {
		const listed = plan.opns.listed ? `, ${plan.opns.listed} listed` : ''
		parts.push(`${plan.opns.count} OpNS name(s)${listed}`)
	}
	for (const t of plan.bsv20) {
		const listed = t.listed ? `, ${t.listed} listed` : ''
		parts.push(`${t.amount} ${t.tick} (${t.count} UTXOs${listed})`)
	}
	for (const t of plan.bsv21) {
		const listed = t.listed ? `, ${t.listed} listed` : ''
		parts.push(
			`${t.amount} ${t.symbol ?? t.tokenId.slice(0, 12)} (${t.count} UTXOs${listed})`,
		)
	}
	return parts
}
