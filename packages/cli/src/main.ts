/**
 * 1sat CLI - Command-line interface for 1Sat Ordinals SDK.
 *
 * Pure Bun CLI with manual arg parsing. No frameworks.
 *
 * Loaded after entry bootstrap sets DOTENV_CONFIG_QUIET so wallet-toolbox
 * import-time dotenv.config() calls stay silent.
 */

import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { config as loadEnv } from 'dotenv'
import { parseGlobalFlags } from './args'
import { handleActionCommand } from './commands/action'
import { handleAuthfetchCommand } from './commands/authfetch'
import { handleConfigCommand } from './commands/config'
import { handleIdentityCommand } from './commands/identity'
import { handleInitCommand } from './commands/init'
import { handleLocksCommand } from './commands/locks'
import { handleMcpProxyCommand } from './commands/mcp-proxy'
import { handleMessageboxCommand } from './commands/messagebox'
import { handleOpnsCommand } from './commands/opns'
import { handleOrdinalsCommand } from './commands/ordinals'
import { handleRemoteCommand } from './commands/remote'
import { handleServeCommand } from './commands/serve'
import { handleSocialCommand } from './commands/social'
import { handleStorageCommand } from './commands/storage'
import { handleSweepCommand } from './commands/sweep'
import { handleTokensCommand } from './commands/tokens'
import { handleTxCommand } from './commands/tx'
import { handleWalletCommand } from './commands/wallet'
import { getCommand, printCommandHelp, printHelp, printVersion } from './help'
import { runMonitorOnce } from './monitor-once'
import { formatError } from './output'

const rawArgs = process.argv.slice(2)

/** Load `--env-file` paths into process.env. File values win over existing env. */
function applyEnvFiles(paths: string[]): void {
	for (const p of paths) {
		const abs = resolve(p)
		if (!existsSync(abs)) {
			throw new Error(`Env file not found: ${p}`)
		}
		const result = loadEnv({ path: abs, quiet: true, override: true })
		if (result.error) {
			throw result.error
		}
	}
}

async function main(): Promise<void> {
	const flags = parseGlobalFlags(rawArgs)
	if (flags.envFiles.length > 0) {
		applyEnvFiles(flags.envFiles)
	}

	if (flags.version) {
		printVersion()
		process.exit(0)
	}

	const [command, ...rest] = flags.rest

	if (!command) {
		printHelp(flags.json)
		process.exit(0)
	}

	if (flags.help) {
		if (getCommand(command)) {
			printCommandHelp(command, flags.json)
		} else {
			printHelp(flags.json)
		}
		process.exit(0)
	}

	switch (command) {
		case 'init':
			await handleInitCommand(rest, flags)
			break

		case 'config':
			await handleConfigCommand(rest, flags)
			break

		case 'remote':
			await handleRemoteCommand(rest, flags)
			break

		case 'authfetch':
			await handleAuthfetchCommand(rest, flags)
			break

		case 'wallet':
			await handleWalletCommand(rest, flags)
			break

		case 'ordinals':
			await handleOrdinalsCommand(rest, flags)
			break

		case 'bsv21':
		case 'tokens': // deprecated alias
			await handleTokensCommand(rest, flags)
			break

		case 'locks':
			await handleLocksCommand(rest, flags)
			break

		case 'identity':
			await handleIdentityCommand(rest, flags)
			break

		case 'social':
			await handleSocialCommand(rest, flags)
			break

		case 'opns':
			await handleOpnsCommand(rest, flags)
			break

		case 'messagebox':
			await handleMessageboxCommand(rest, flags)
			break

		case 'sweep':
			await handleSweepCommand(rest, flags)
			break

		case 'action':
			await handleActionCommand(rest, flags)
			break

		case 'tx':
			await handleTxCommand(rest, flags)
			break

		case 'mcp-proxy':
			await handleMcpProxyCommand()
			break

		case 'serve':
			await handleServeCommand(rest, flags)
			break

		case 'storage':
			await handleStorageCommand(rest, flags)
			break

		// Hidden: parent CLI spawns this after wallet destroy so monitor
		// stdout/stderr go to ~/.1sat/cli/monitor.log instead of the TTY.
		case '__monitor-once':
			await runMonitorOnce(flags.chain)
			break

		case 'help':
			printHelp(flags.json)
			break

		default:
			console.error(formatError(`Unknown command: ${command}`))
			printHelp(flags.json)
			process.exit(1)
	}
}

main().catch((err) => {
	console.error(formatError(`Error: ${err.message}`))
	if (process.env.DEBUG) console.error(err.stack)
	process.exit(1)
})
