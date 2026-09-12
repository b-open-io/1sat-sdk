/**
 * Transferable sweep classes. Locked and RUN outputs are leftover, not classes.
 */
export const SWEEP_CLASSES = [
	'bsv',
	'ordinals',
	'opns',
	'bsv20',
	'bsv21',
] as const

export type SweepClass = (typeof SWEEP_CLASSES)[number]

const ALIASES: Record<string, SweepClass> = {
	bsv: 'bsv',
	funding: 'bsv',
	ordinals: 'ordinals',
	ord: 'ordinals',
	opns: 'opns',
	names: 'opns',
	bsv20: 'bsv20',
	bsv21: 'bsv21',
}

export function parseSweepClasses(
	raw: string | undefined,
	flag: string,
): Set<SweepClass> {
	if (!raw) return new Set()
	const selected = new Set<SweepClass>()
	for (const token of raw.split(',').map((t) => t.trim().toLowerCase())) {
		if (!token) continue
		const mapped = ALIASES[token]
		if (!mapped) {
			throw new Error(
				`Unknown ${flag} class '${token}'. Use: ${SWEEP_CLASSES.join(', ')}`,
			)
		}
		selected.add(mapped)
	}
	return selected
}

/** Default is every transferable class. `--only` and `--skip` are exclusive. */
export function selectedSweepClasses(
	only: string | undefined,
	skip: string | undefined,
): Set<SweepClass> {
	if (only && skip) {
		throw new Error('--only and --skip are mutually exclusive')
	}
	if (only) {
		const selected = parseSweepClasses(only, '--only')
		if (selected.size === 0) {
			throw new Error('--only requires at least one class')
		}
		return selected
	}
	const selected = new Set<SweepClass>(SWEEP_CLASSES)
	if (skip) {
		for (const cls of parseSweepClasses(skip, '--skip')) selected.delete(cls)
	}
	return selected
}
