/**
 * Help text and version display for the 1sat CLI.
 */

import { readFileSync } from 'node:fs'
import chalk from 'chalk'

const VERSION = (() => {
	try {
		const pkg = JSON.parse(
			readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
		)
		return pkg.version || '0.0.11'
	} catch {
		return '0.0.11'
	}
})()

export function getVersion(): string {
	return VERSION
}

export function printVersion(): void {
	console.log(`1sat ${getVersion()}`)
}

export function printHelp(): void {
	const dim = chalk.dim
	const cyan = chalk.cyan
	const bold = chalk.bold

	console.log(`
${bold('1sat')} - CLI for 1Sat Ordinals SDK

${bold('Usage:')}
  1sat <command> [subcommand] [options]

${bold('Setup:')}
  ${cyan('init')}                     Interactive wallet setup wizard
  ${cyan('config')} <subcommand>      Manage configuration
  ${cyan('remote')} <subcommand>      Manage remote storage

${bold('Wallet:')}
  ${cyan('wallet balance')}           Show wallet balance
  ${cyan('wallet address')}           Show deposit address
  ${cyan('wallet send')}              Send BSV to an address
  ${cyan('wallet send-all')}          Send all BSV to an address
  ${cyan('wallet info')}              Show wallet info

${bold('Ordinals:')}
  ${cyan('ordinals list')}            List owned ordinals
  ${cyan('ordinals mint')}            Mint a new ordinal inscription
  ${cyan('ordinals transfer')}        Transfer an ordinal
  ${cyan('ordinals sell')}            List an ordinal for sale
  ${cyan('ordinals cancel')}          Cancel an ordinal listing
  ${cyan('ordinals buy')}             Purchase a listed ordinal

${bold('Tokens (BSV21):')}
  ${cyan('tokens balances')}          Show token balances
  ${cyan('tokens list')}              List owned token UTXOs
  ${cyan('tokens send')}              Transfer tokens
  ${cyan('tokens deploy')}            Deploy a new BSV21 token
  ${cyan('tokens buy')}               Purchase listed tokens

${bold('Locks:')}
  ${cyan('locks info')}               Show lock information
  ${cyan('locks lock')}               Time-lock BSV
  ${cyan('locks unlock')}             Unlock matured BSV

${bold('Identity (BAP):')}
  ${cyan('identity create')}          Create a new BAP identity
  ${cyan('identity info')}            Show identity information
  ${cyan('identity sign')}            Sign a message with identity key
  ${cyan('identity verify')}          Verify a signed message

${bold('Social:')}
  ${cyan('social post')}              Create an on-chain social post

${bold('OpNS:')}
  ${cyan('opns register')}            Register identity on OpNS name
  ${cyan('opns deregister')}          Deregister identity from OpNS name
  ${cyan('opns lookup')}              Look up an OpNS name

${bold('Sweep:')}
  ${cyan('sweep scan')}               Scan an address for UTXOs
  ${cyan('sweep import')}             Import UTXOs into wallet

${bold('Advanced:')}
  ${cyan('action')} <name> [json]     Execute a registered action by name
  ${cyan('tx decode')} <hex>          Decode a raw transaction

${bold('Global Options:')}
  ${dim('--json')}                   Output as JSON
  ${dim('--quiet, -q')}              Suppress output
  ${dim('--yes, -y')}                Skip confirmations
  ${dim('--chain <main|test>')}      Network (default: main)
  ${dim('--help, -h')}               Show help
  ${dim('--version, -v')}            Show version

${bold('Environment Variables:')}
  ${dim('PRIVATE_KEY_WIF')}          Private key (bypasses encrypted keyfile)
  ${dim('ONESAT_PASSWORD')}          Password for encrypted keyfile

${bold('Config:')} ~/.1sat/cli/
`)
}

export function printCommandHelp(
	command: string,
	subcommands: Record<string, string>,
): void {
	const bold = chalk.bold
	const cyan = chalk.cyan
	const dim = chalk.dim

	console.log(`\n${bold(`1sat ${command}`)}`)
	console.log(`\n${bold('Subcommands:')}`)
	for (const [sub, desc] of Object.entries(subcommands)) {
		console.log(`  ${cyan(sub.padEnd(20))} ${dim(desc)}`)
	}
	console.log()
}
