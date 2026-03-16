/**
 * Argument parsing utilities for the 1sat CLI.
 *
 * Pure manual parsing - no frameworks. Follows clawnet pattern.
 */

export interface GlobalFlags {
	json: boolean
	quiet: boolean
	yes: boolean
	chain: 'main' | 'test'
	help: boolean
	version: boolean
	rest: string[]
}

/**
 * Parse global flags from raw argv, returning structured flags and remaining args.
 */
export function parseGlobalFlags(args: string[]): GlobalFlags {
	let json = false
	let quiet = false
	let yes = false
	let chain: 'main' | 'test' = 'main'
	let help = false
	let version = false
	const rest: string[] = []
	const skip = new Set<number>()

	for (let i = 0; i < args.length; i++) {
		if (skip.has(i)) continue

		const arg = args[i]

		switch (arg) {
			case '--json':
				json = true
				break
			case '--quiet':
			case '-q':
				quiet = true
				break
			case '--yes':
			case '-y':
				yes = true
				break
			case '--chain': {
				const value = args[i + 1]
				if (value === 'main' || value === 'test') {
					chain = value
					skip.add(i + 1)
				} else {
					throw new Error(
						`Invalid chain value: ${value}. Must be 'main' or 'test'.`,
					)
				}
				break
			}
			case '--help':
			case '-h':
				help = true
				break
			case '--version':
			case '-v':
				version = true
				break
			default:
				rest.push(arg)
		}
	}

	return { json, quiet, yes, chain, help, version, rest }
}

/**
 * Extract a named flag value from args.
 * Returns the value following the flag, or undefined if not found.
 */
export function extractFlag(args: string[], flag: string): string | undefined {
	const idx = args.indexOf(flag)
	if (idx === -1 || idx + 1 >= args.length) return undefined
	return args[idx + 1]
}

/**
 * Check if a boolean flag is present.
 */
export function hasFlag(args: string[], flag: string): boolean {
	return args.includes(flag)
}

/**
 * Extract positional arguments, skipping flag indices.
 */
export function extractPositional(
	args: string[],
	skipIndices: Set<number>,
): string[] {
	return args.filter((arg, i) => !arg.startsWith('--') && !skipIndices.has(i))
}
