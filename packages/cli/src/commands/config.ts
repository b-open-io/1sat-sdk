/**
 * Config command - show, set, and locate configuration.
 *
 * Subcommands:
 *   show   - Display current configuration
 *   set    - Set a configuration value
 *   unset  - Remove a configuration key
 *   path   - Print config directory path
 */

import type { GlobalFlags } from '../args'
import {
	type OneSatCliConfig,
	getConfigDir,
	getConfigFile,
	loadConfig,
	updateConfig,
} from '../config'
import { printCommandHelp } from '../help'
import {
	fatal,
	formatLabel,
	formatSuccess,
	formatValue,
	output,
	printKeyValue,
} from '../output'

const SETTABLE_KEYS: Array<keyof OneSatCliConfig> = [
	'chain',
	'dataDir',
	'storageIdentityKey',
	'monitorIntervalMinutes',
]

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
			printCommandHelp('config', {
				show: 'Display current configuration',
				set: 'Set a config value (e.g. 1sat config set chain test)',
				unset: 'Remove a configuration key (e.g. 1sat config unset chain)',
				path: 'Print config directory path',
			})
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
	printKeyValue({
		chain: config.chain,
		dataDir: config.dataDir,
		storageIdentityKey: config.storageIdentityKey ?? '(not set)',
		monitorIntervalMinutes: config.monitorIntervalMinutes,
	})
	console.log()
	console.log(
		`  ${formatLabel('config file:')}  ${formatValue(getConfigFile())}`,
	)
	console.log()
}

function configSet(args: string[], opts: GlobalFlags): void {
	const [key, value] = args

	if (!key || !value) {
		fatal(
			`Usage: 1sat config set <key> <value>\n\nSettable keys: ${SETTABLE_KEYS.join(', ')}`,
		)
	}

	if (!SETTABLE_KEYS.includes(key as keyof OneSatCliConfig)) {
		fatal(
			`Unknown config key: ${key}\n\nSettable keys: ${SETTABLE_KEYS.join(', ')}`,
		)
	}

	// Validate specific keys
	if (key === 'chain' && value !== 'main' && value !== 'test') {
		fatal("chain must be 'main' or 'test'")
	}
	if (key === 'monitorIntervalMinutes') {
		const n = Number(value)
		if (!Number.isFinite(n) || n < 0) {
			fatal('monitorIntervalMinutes must be a non-negative number (0 to disable)')
		}
	}

	const updated = updateConfig({ [key]: value })
	output(opts.json ? updated : formatSuccess(`Set ${key} = ${value}`), opts)
}

function configUnset(args: string[], opts: GlobalFlags): void {
	const [key] = args

	if (!key) {
		fatal(
			`Usage: 1sat config unset <key>\n\nKeys that can be unset: ${SETTABLE_KEYS.join(', ')}`,
		)
	}

	if (!SETTABLE_KEYS.includes(key as keyof OneSatCliConfig)) {
		fatal(
			`Unknown config key: ${key}\n\nKeys that can be unset: ${SETTABLE_KEYS.join(', ')}`,
		)
	}

	// For other keys, use undefined
	const updated = updateConfig({ [key]: undefined })
	output(opts.json ? updated : formatSuccess(`Unset ${key}`), opts)
}

function configPath(opts: GlobalFlags): void {
	const dir = getConfigDir()
	output(opts.json ? { path: dir } : dir, opts)
}
