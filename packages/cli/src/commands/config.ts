/**
 * Config command - show, set, and locate configuration.
 *
 * Subcommands:
 *   show   - Display current configuration
 *   set    - Set a configuration value
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
	'remoteStorageUrl',
	'storageIdentityKey',
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
		case 'path':
			return configPath(opts)
		default:
			printCommandHelp('config', {
				show: 'Display current configuration',
				set: 'Set a config value (e.g. 1sat config set chain test)',
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
		remoteStorageUrl: config.remoteStorageUrl ?? '(not set)',
		storageIdentityKey: config.storageIdentityKey ?? '(not set)',
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

	const updated = updateConfig({ [key]: value })
	output(opts.json ? updated : formatSuccess(`Set ${key} = ${value}`), opts)
}

function configPath(opts: GlobalFlags): void {
	const dir = getConfigDir()
	output(opts.json ? { path: dir } : dir, opts)
}
