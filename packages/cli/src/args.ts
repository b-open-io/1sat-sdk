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
	/** Paths from `--env-file` / `--env-file=path` (may be empty). */
	envFiles: string[]
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
	const envFiles: string[] = []
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
			case '--env-file': {
				const value = args[i + 1]
				if (!value || value.startsWith('-')) {
					throw new Error('--env-file requires a path')
				}
				envFiles.push(value)
				skip.add(i + 1)
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
				if (arg.startsWith('--env-file=')) {
					const value = arg.slice('--env-file='.length)
					if (!value) {
						throw new Error('--env-file requires a path')
					}
					envFiles.push(value)
				} else {
					rest.push(arg)
				}
		}
	}

	return { json, quiet, yes, chain, envFiles, help, version, rest }
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
 * Extract multiple values for a flag, supporting comma-delimited and multiple flag occurrences.
 * Example: --tags a,b,c OR --tags a --tags b --tags c
 */
export function extractFlags(args: string[], flag: string): string[] {
	const values: string[] = []
	for (let i = 0; i < args.length - 1; i++) {
		if (args[i] === flag) {
			const value = args[i + 1]
			if (value && !value.startsWith('--')) {
				// Split comma-delimited values
				values.push(...value.split(',').filter((v) => v.length > 0))
			}
		}
	}
	return values
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
