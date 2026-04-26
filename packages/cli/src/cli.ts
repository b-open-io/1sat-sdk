#!/usr/bin/env bun

/**
 * 1sat CLI - Command-line interface for 1Sat Ordinals SDK.
 *
 * Pure Bun CLI with manual arg parsing. No frameworks.
 */

import { parseGlobalFlags } from './args'
import { handleActionCommand } from './commands/action'
import { handleConfigCommand } from './commands/config'
import { handleIdentityCommand } from './commands/identity'
import { handleInitCommand } from './commands/init'
import { handleLocksCommand } from './commands/locks'
import { handleMcpProxyCommand } from './commands/mcp-proxy'
import { handleOpnsCommand } from './commands/opns'
import { handleOrdinalsCommand } from './commands/ordinals'
import { handleRemoteCommand } from './commands/remote'
import { handleServeCommand } from './commands/serve'
import { handleSocialCommand } from './commands/social'
import { handleSweepCommand } from './commands/sweep'
import { handleTokensCommand } from './commands/tokens'
import { handleTxCommand } from './commands/tx'
import { handleWalletCommand } from './commands/wallet'
import { getCommand, printCommandHelp, printHelp, printVersion } from './help'
import { formatError } from './output'

const rawArgs = process.argv.slice(2)

async function main(): Promise<void> {
	const flags = parseGlobalFlags(rawArgs)

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

		case 'wallet':
			await handleWalletCommand(rest, flags)
			break

		case 'ordinals':
			await handleOrdinalsCommand(rest, flags)
			break

		case 'tokens':
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
