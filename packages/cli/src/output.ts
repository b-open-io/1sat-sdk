/**
 * Output formatting utilities for the 1sat CLI.
 *
 * Supports --json and --quiet modes.
 */

import chalk from 'chalk'

export function formatSuccess(msg: string): string {
	return chalk.green(msg)
}

export function formatError(msg: string): string {
	return chalk.red(msg)
}

export function formatValue(val: string | number): string {
	return chalk.cyan(String(val))
}

export function formatLabel(label: string): string {
	return chalk.dim(label)
}

export function formatWarning(msg: string): string {
	return chalk.yellow(msg)
}

/**
 * Output data in the appropriate format based on flags.
 *
 * --json: JSON output (machine-readable)
 * --quiet: suppress all output
 * default: human-readable
 */
export function output(
	data: unknown,
	opts: { json?: boolean; quiet?: boolean },
): void {
	if (opts.quiet) return

	if (opts.json) {
		console.log(JSON.stringify(data, null, 2))
		return
	}

	if (typeof data === 'string') {
		console.log(data)
		return
	}

	if (typeof data === 'object' && data !== null) {
		for (const [key, value] of Object.entries(data)) {
			if (Array.isArray(value)) {
				console.log(`${formatLabel(`${key}:`)}`)
				for (const item of value) {
					if (typeof item === 'object' && item !== null) {
						const parts = Object.entries(item)
							.map(([k, v]) => `${k}=${v}`)
							.join(' ')
						console.log(`  ${formatValue(parts)}`)
					} else {
						console.log(`  ${formatValue(String(item))}`)
					}
				}
			} else if (typeof value === 'object' && value !== null) {
				console.log(`${formatLabel(`${key}:`)} ${JSON.stringify(value)}`)
			} else {
				console.log(`${formatLabel(`${key}:`)} ${formatValue(String(value))}`)
			}
		}
		return
	}

	console.log(String(data))
}

/**
 * Print an error message and exit.
 */
export function fatal(msg: string): never {
	console.error(formatError(`Error: ${msg}`))
	process.exit(1)
}

/**
 * Print a table of key-value pairs.
 */
export function printKeyValue(
	pairs: Record<string, string | number | boolean | undefined>,
): void {
	const maxKeyLen = Math.max(...Object.keys(pairs).map((k) => k.length))
	for (const [key, value] of Object.entries(pairs)) {
		if (value === undefined) continue
		const paddedKey = key.padEnd(maxKeyLen)
		console.log(`  ${formatLabel(paddedKey)}  ${formatValue(String(value))}`)
	}
}
