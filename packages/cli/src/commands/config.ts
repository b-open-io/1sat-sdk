/**
 * Config command - show, set, and locate configuration.
 *
 * Subcommands:
 *   show   - Display current configuration
 *   set    - Set a configuration value
 *   unset  - Remove a configuration key
 *   path   - Print config directory path
 */

import type { GlobalFlags } from '../args.js'
import {
	getConfigDir,
	getConfigFile,
	loadConfig,
	parseConfigValue,
	setConfigPath,
	unsetConfigPath,
} from '../config.js'
import { printCommandHelp } from '../help.js'
import {
	fatal,
	formatLabel,
	formatSuccess,
	formatValue,
	output,
} from '../output.js'

export async function handleConfigCommand(
	args: string[],
	opts: GlobalFlags,
): Promise<void> {
	const [subcommand, ...rest] = args

	switch (subcommand) {
		case 'show':
			return configShow(opts)
		case 'set':
			return configSet(rest, opts)
		case 'unset':
			return configUnset(rest, opts)
		case 'path':
			return configPath(opts)
		default:
			printCommandHelp('config', opts.json)
			if (subcommand && subcommand !== 'help') {
				process.exit(1)
			}
	}
}

function configShow(opts: GlobalFlags): void {
	const config = loadConfig()

	if (opts.json) {
		output(config, opts)
		return
	}

	console.log()
	printNested(config, '')
	console.log()
	console.log(
		`  ${formatLabel('config file:')}  ${formatValue(getConfigFile())}`,
	)
	console.log()
}

function printNested(value: unknown, prefix: string): void {
	if (value == null || typeof value !== 'object' || Array.isArray(value)) {
		console.log(
			`  ${formatLabel(`${prefix || '(value)'}:`)}  ${formatValue(String(value))}`,
		)
		return
	}
	const obj = value as Record<string, unknown>
	for (const [k, v] of Object.entries(obj)) {
		const path = prefix ? `${prefix}.${k}` : k
		if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
			printNested(v, path)
		} else {
			const display = Array.isArray(v)
				? JSON.stringify(v)
				: String(v ?? '(not set)')
			console.log(`  ${formatLabel(`${path}:`)}  ${formatValue(display)}`)
		}
	}
}

function configSet(args: string[], opts: GlobalFlags): void {
	const [key, ...valueArgs] = args
	const value = valueArgs.join(' ')

	if (!key || valueArgs.length === 0) {
		fatal('Usage: 1sat config set <dotted.path> <value>')
	}

	const parsed = parseConfigValue(value)
	validateKnownPath(key, parsed)

	setConfigPath(key, parsed)
	output(
		opts.json ? { [key]: parsed } : formatSuccess(`Set ${key} = ${value}`),
		opts,
	)
}

function configUnset(args: string[], opts: GlobalFlags): void {
	const [key] = args

	if (!key) {
		fatal('Usage: 1sat config unset <dotted.path>')
	}

	unsetConfigPath(key)
	output(opts.json ? { [key]: undefined } : formatSuccess(`Unset ${key}`), opts)
}

/**
 * Enforce the few semantic constraints we care about. Unknown paths are
 * allowed — callers that read them can validate at consumption time.
 */
function validateKnownPath(key: string, value: unknown): void {
	switch (key) {
		case 'chain':
			if (value !== 'main' && value !== 'test') {
				fatal("chain must be 'main' or 'test'")
			}
			break
		case 'server.storage.provider':
			if (value !== 'bun-sqlite' && value !== 'pg') {
				fatal("server.storage.provider must be 'bun-sqlite' | 'pg'")
			}
			break
		case 'server.port':
			if (typeof value !== 'number' || value <= 0 || !Number.isInteger(value)) {
				fatal('server.port must be a positive integer')
			}
			break
		case 'server.accounts.enabled':
			if (typeof value !== 'boolean') {
				fatal('server.accounts.enabled must be true or false')
			}
			break
	}
}

function configPath(opts: GlobalFlags): void {
	const dir = getConfigDir()
	output(opts.json ? { path: dir } : dir, opts)
}
