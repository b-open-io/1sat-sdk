/**
 * Help text and version display for the 1sat CLI.
 *
 * COMMANDS is the single source of truth. Both text help and `--json`
 * agent-discovery output are rendered from it.
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

export interface ArgSpec {
	flag: string
	values?: string
	description?: string
	required?: boolean
}

export interface SubcommandSpec {
	name: string
	description: string
	positional?: string
	args?: ArgSpec[]
	unavailable?: boolean
	notes?: string
}

export interface CommandSpec {
	group: string
	name: string
	description: string
	positional?: string
	args?: ArgSpec[]
	subcommands?: SubcommandSpec[]
	notes?: string
}

export const GLOBAL_OPTIONS: ArgSpec[] = [
	{ flag: '--json', description: 'Output as JSON' },
	{ flag: '--quiet', description: 'Suppress output (also -q)' },
	{ flag: '--yes', description: 'Skip confirmation prompts (also -y)' },
	{
		flag: '--chain',
		values: '<main|test>',
		description: 'Network (default: main)',
	},
	{
		flag: '--env-file',
		values: '<path>',
		description:
			'Load env vars from a file (repeatable; file values override existing env)',
	},
	{ flag: '--help', description: 'Show help (also -h)' },
	{ flag: '--version', description: 'Show version (also -v)' },
]

export const ENV_VARS: { name: string; description: string }[] = [
	{
		name: 'PRIVATE_KEY_WIF',
		description: 'WIF private key (bypasses encrypted keyfile)',
	},
	{ name: 'ONESAT_PASSWORD', description: 'Password for encrypted keyfile' },
	{
		name: 'ONESAT_PORT',
		description: 'Override server port (used by `1sat serve`)',
	},
	{
		name: 'ONESAT_MCP_URL',
		description:
			'Override wallet-desktop MCP URL (default http://127.0.0.1:3322)',
	},
]

export const COMMANDS: CommandSpec[] = [
	// Setup
	{
		group: 'Setup',
		name: 'init',
		description:
			'Interactive wallet setup wizard (creates encrypted keyfile and config)',
	},
	{
		group: 'Setup',
		name: 'config',
		description: 'Manage CLI configuration in ~/.1sat/cli/config.json',
		subcommands: [
			{ name: 'show', description: 'Display current configuration' },
			{
				name: 'set',
				description: 'Set a config value',
				positional: '<dotted.path> <value>',
			},
			{
				name: 'unset',
				description: 'Remove a configuration key',
				positional: '<dotted.path>',
			},
			{ name: 'path', description: 'Print config directory path' },
		],
	},
	{
		group: 'Setup',
		name: 'remote',
		description: 'Manage remote wallet storage',
		subcommands: [
			{
				name: 'add',
				description: 'Add a remote storage as backup',
				positional: '<url>',
			},
			{
				name: 'list',
				description: 'List configured remotes and active storage',
			},
			{
				name: 'delete',
				description: 'Remove a remote from the backup list',
				positional: '<url>',
			},
			{
				name: 'set-active',
				description: 'Switch active storage to a remote or back to local',
				positional: '<url | local>',
			},
			{
				name: 'status',
				description: 'Fetch GET /account/status from a remote',
				positional: '[url]',
			},
			{
				name: 'topup',
				description: 'Buy capacity on a remote',
				positional: '[url]',
				args: [{ flag: '--units', values: '<n>' }],
			},
		],
	},

	// Wallet
	{
		group: 'Wallet',
		name: 'wallet',
		description: 'Wallet operations (balance, send, BRC-100 interface)',
		subcommands: [
			{ name: 'balance', description: 'Show wallet balance in satoshis' },
			{
				name: 'address',
				description: 'Show BRC-29 deposit address(es)',
				args: [
					{
						flag: '--prefix',
						values: '<p>',
						description: 'BRC-29 prefix (default: 1sat)',
					},
					{ flag: '--start-index', values: '<n>' },
					{ flag: '--count', values: '<n>' },
				],
			},
			{
				name: 'send',
				description:
					'Send BSV. Specify exactly one of --to, --script, or --data-asm',
				args: [
					{ flag: '--to', values: '<address>' },
					{ flag: '--script', values: '<hex>' },
					{ flag: '--data-asm', values: '"<asm>"' },
					{
						flag: '--sats',
						values: '<n>',
						description: 'Required with --to or --script',
					},
				],
			},
			{
				name: 'send-all',
				description: 'Send all BSV to an address (empties the wallet)',
				args: [{ flag: '--to', values: '<address>', required: true }],
			},
			{
				name: 'sync',
				description: 'Sync inbound payments at BRC-29 deposit addresses',
				args: [
					{ flag: '--prefix', values: '<p>' },
					{ flag: '--start-index', values: '<n>' },
					{ flag: '--count', values: '<n>' },
				],
			},
			{
				name: 'info',
				description: 'Show address, identity key, balance, and network',
			},
			{
				name: 'list-outputs',
				description: 'List wallet outputs in a basket (BRC-100)',
				args: [
					{ flag: '--basket', values: '<name>', required: true },
					{ flag: '--tags', values: '<t1,t2>' },
					{ flag: '--limit', values: '<n>' },
					{ flag: '--include-tags' },
					{ flag: '--include', values: '<val>' },
				],
			},
			{
				name: 'relinquish-output',
				description: 'Remove output from basket (BRC-100)',
				args: [
					{ flag: '--basket', values: '<name>', required: true },
					{ flag: '--output', values: '<txid.vout>', required: true },
				],
			},
			{
				name: 'list-actions',
				description: 'List wallet actions (BRC-100)',
				args: [
					{ flag: '--labels', values: '<l1,l2>' },
					{ flag: '--limit', values: '<n>' },
				],
			},
			{
				name: 'create-action',
				description: 'Create a raw action (BRC-100)',
				positional: "'<json>'",
			},
			{
				name: 'sign-action',
				description: 'Sign a raw action (BRC-100)',
				positional: "'<json>'",
			},
			{
				name: 'abort-action',
				description: 'Abort a pending action (BRC-100)',
				args: [{ flag: '--reference', values: '<ref>', required: true }],
			},
			{
				name: 'list-certificates',
				description: 'List certificates (BRC-100)',
				args: [
					{ flag: '--certifiers', values: '<c1,c2>' },
					{ flag: '--types', values: '<t1,t2>' },
					{ flag: '--limit', values: '<n>' },
				],
			},
			{
				name: 'relinquish-certificate',
				description: 'Relinquish a certificate (BRC-100)',
				args: [
					{ flag: '--type', values: '<t>', required: true },
					{ flag: '--serialNumber', values: '<s>', required: true },
					{ flag: '--certifier', values: '<c>', required: true },
				],
			},
		],
	},

	// Ordinals
	{
		group: 'Ordinals',
		name: 'ordinals',
		description: '1Sat Ordinal inscriptions',
		subcommands: [
			{ name: 'list', description: 'List owned ordinals/inscriptions' },
			{
				name: 'mint',
				description: 'Mint a new ordinal inscription',
				args: [
					{ flag: '--file', values: '<path>', required: true },
					{
						flag: '--type',
						values: '<mime>',
						description: 'Override auto-detected MIME type',
					},
					{
						flag: '--map',
						values: '<json>',
						description: 'MAP metadata as JSON object',
					},
					{
						flag: '--sign-with-bap',
						description: 'Sign inscription with BAP identity',
					},
				],
			},
			{
				name: 'transfer',
				description: 'Transfer an ordinal',
				args: [
					{ flag: '--outpoint', values: '<txid.vout>', required: true },
					{ flag: '--to', values: '<address>', required: true },
				],
			},
			{
				name: 'sell',
				description: 'List an ordinal for sale (OrdLock)',
				args: [
					{ flag: '--outpoint', values: '<txid.vout>', required: true },
					{ flag: '--price', values: '<sats>', required: true },
				],
			},
			{
				name: 'cancel',
				description: 'Cancel an ordinal listing',
				args: [{ flag: '--outpoint', values: '<txid.vout>', required: true }],
			},
			{
				name: 'buy',
				description: 'Purchase a listed ordinal',
				args: [{ flag: '--outpoint', values: '<txid.vout>', required: true }],
			},
			{
				name: 'burn',
				description: 'Burn ordinals permanently',
				args: [
					{ flag: '--outpoints', values: '<op1,op2,...>', required: true },
				],
			},
		],
	},

	// Tokens
	{
		group: 'Tokens (BSV21)',
		name: 'tokens',
		description: 'BSV21 fungible tokens',
		subcommands: [
			{ name: 'balances', description: 'Show token balances by token ID' },
			{
				name: 'list',
				description: 'List owned token UTXOs',
				args: [{ flag: '--token-id', values: '<id>' }],
			},
			{
				name: 'send',
				description: 'Transfer tokens',
				args: [
					{ flag: '--token-id', values: '<id>', required: true },
					{ flag: '--amount', values: '<n>', required: true },
					{ flag: '--to', values: '<address>' },
					{ flag: '--counterparty', values: '<pubkey-hex>' },
					{ flag: '--locking-script', values: '<hex>' },
				],
			},
			{
				name: 'deploy-mint',
				description: 'Deploy a new BSV21 token with fixed supply (deploy+mint)',
				args: [
					{ flag: '--symbol', values: '<ticker>', required: true },
					{ flag: '--amount', values: '<total-supply>', required: true },
					{ flag: '--decimals', values: '<0-18>' },
					{ flag: '--icon', values: '<url-or-data-uri>' },
					{ flag: '--to', values: '<address>' },
					{ flag: '--counterparty', values: '<pubkey-hex>' },
					{ flag: '--locking-script', values: '<hex>' },
				],
			},
			{
				name: 'deploy-auth',
				description:
					'Deploy a new BSV21 token with mintable supply via auth UTXOs (deploy+auth)',
				args: [
					{ flag: '--symbol', values: '<ticker>', required: true },
					{ flag: '--decimals', values: '<0-18>' },
					{ flag: '--icon', values: '<url-or-data-uri>' },
					{ flag: '--to', values: '<address>' },
					{ flag: '--counterparty', values: '<pubkey-hex>' },
					{ flag: '--locking-script', values: '<hex>' },
				],
			},
			{
				name: 'mint',
				description:
					'Spend an auth UTXO to mint new supply, re-issue authority, or burn it',
				args: [
					{ flag: '--token-id', values: '<id>', required: true },
					{ flag: '--amount', values: '<n>' },
					{ flag: '--to', values: '<address>' },
					{ flag: '--counterparty', values: '<pubkey-hex>' },
					{ flag: '--locking-script', values: '<hex>' },
					{ flag: '--auth-to', values: '<address>' },
					{ flag: '--auth-counterparty', values: '<pubkey-hex>' },
					{ flag: '--auth-locking-script', values: '<hex>' },
					{ flag: '--end-minting' },
				],
			},
			{
				name: 'buy',
				description: 'Purchase listed tokens',
				args: [
					{ flag: '--outpoint', values: '<txid.vout>', required: true },
					{ flag: '--token-id', values: '<id>', required: true },
					{ flag: '--amount', values: '<n>', required: true },
				],
			},
		],
	},

	// Locks
	{
		group: 'Locks',
		name: 'locks',
		description: 'Time-locked BSV',
		subcommands: [
			{ name: 'info', description: 'Show locked totals and maturity status' },
			{
				name: 'lock',
				description: 'Time-lock BSV until a block height',
				args: [
					{ flag: '--sats', values: '<amount>', required: true },
					{
						flag: '--blocks',
						values: '<n>',
						required: true,
						description: 'Target unlock block height',
					},
				],
			},
			{ name: 'unlock', description: 'Unlock all matured locks' },
		],
	},

	// Identity
	{
		group: 'Identity (BAP)',
		name: 'identity',
		description: 'BAP (Bitcoin Attestation Protocol) identity management',
		subcommands: [
			{ name: 'create', description: 'Create/publish a BAP identity on-chain' },
			{
				name: 'update-profile',
				description: 'Update BAP identity profile',
				args: [{ flag: '--profile', values: '<json>', required: true }],
			},
			{ name: 'info', description: 'Show identity public key' },
			{
				name: 'sign',
				description: 'Sign a message with identity key (BSM)',
				args: [
					{ flag: '--message', values: '<text>', required: true },
					{ flag: '--encoding', values: '<utf8|hex|base64>' },
				],
			},
			{
				name: 'verify',
				description: 'Verify a signed message',
				unavailable: true,
				notes: 'Not yet implemented.',
				args: [
					{ flag: '--message', values: '<text>', required: true },
					{ flag: '--sig', values: '<sig>', required: true },
					{ flag: '--address', values: '<addr>', required: true },
				],
			},
		],
	},

	// Social
	{
		group: 'Social',
		name: 'social',
		description: 'On-chain social posts (BSocial)',
		subcommands: [
			{
				name: 'post',
				description: 'Create an on-chain social post',
				args: [
					{ flag: '--content', values: '<text>', required: true },
					{ flag: '--app', values: '<name>' },
					{
						flag: '--content-type',
						values: '<text/plain|text/markdown>',
					},
					{ flag: '--tags', values: '<t1,t2>' },
				],
			},
		],
	},

	// OpNS
	{
		group: 'OpNS',
		name: 'opns',
		description: 'Ordinals Name System — on-chain names',
		subcommands: [
			{
				name: 'register',
				description: 'Register a payment identity key on an OpNS name',
				args: [{ flag: '--outpoint', values: '<txid.vout>', required: true }],
			},
			{
				name: 'deregister',
				description: 'Deregister the payment identity from an OpNS name',
				args: [{ flag: '--outpoint', values: '<txid.vout>', required: true }],
			},
			{ name: 'lookup', description: 'List OpNS names from wallet' },
			{
				name: 'sell',
				description: 'List an OpNS name for sale',
				args: [
					{ flag: '--outpoint', values: '<txid.vout>', required: true },
					{ flag: '--price', values: '<satoshis>', required: true },
					{
						flag: '--pay-address',
						values: '<address>',
						required: false,
					},
				],
			},
			{
				name: 'buy',
				description: 'Purchase an OpNS name listing',
				args: [{ flag: '--outpoint', values: '<txid.vout>', required: true }],
			},
			{
				name: 'cancel-listing',
				description: 'Cancel a market listing on an OpNS name',
				args: [{ flag: '--outpoint', values: '<txid.vout>', required: true }],
			},
		],
	},

	// Sweep
	{
		group: 'Sweep',
		name: 'sweep',
		description: 'Import assets from external private keys',
		subcommands: [
			{
				name: 'scan',
				description:
					'Scan an address for sweepable UTXOs (BSV, ordinals, BSV21)',
				args: [{ flag: '--wif', values: '<key>', required: true }],
			},
			{
				name: 'import',
				description: 'Sweep UTXOs from a WIF into the wallet',
				args: [{ flag: '--wif', values: '<key>', required: true }],
			},
		],
	},

	// Server
	{
		group: 'Server',
		name: 'serve',
		description:
			'Run unified host server (storage + hosting + paymail + messagebox) and/or monitor (config under server.* in config.json)',
		subcommands: [
			{
				name: '(no subcommand)',
				description: 'Host server + monitor daemon',
			},
			{ name: 'wallet', description: 'Wallet storage server only (BRC-100 HTTP)' },
			{ name: 'monitor', description: 'Monitor daemon only' },
		],
	},
	{
		group: 'Server',
		name: 'storage',
		description:
			'Serve-wallet storage maintenance (config under server.storage in config.json)',
		subcommands: [
			{
				name: 'unfail',
				description:
					'Nominate invalid proven_tx_reqs for chain re-check; the running monitor restores any that actually mined',
				args: [
					{
						flag: '--window',
						values: "<all|30d|12h|90m>",
						required: true,
						description:
							"Only reqs created within the window; 'all' for every invalid record",
					},
				],
			},
		],
	},

	// MCP
	{
		group: 'MCP',
		name: 'mcp-proxy',
		description:
			'stdio JSON-RPC bridge to a running wallet-desktop MCP server (default http://127.0.0.1:3322). Performs BRC-31 handshake using ~/.1sat-wallet/mcp-agent.key.',
	},

	// Advanced
	{
		group: 'Advanced',
		name: 'action',
		description:
			'Execute any registered @1sat/actions action by name. Run with no args to list all actions.',
		positional: "[<name> ['<json>']]",
	},
	{
		group: 'Advanced',
		name: 'tx',
		description: 'Transaction utilities',
		subcommands: [
			{
				name: 'decode',
				description: 'Decode a raw transaction hex',
				positional: '<hex>',
			},
		],
	},

	// Help
	{
		group: 'Help',
		name: 'help',
		description:
			'Show this help. Use --json for machine-readable output. Use `1sat <command> help` for per-command help.',
	},
]

export function getCommand(name: string): CommandSpec | undefined {
	return COMMANDS.find((c) => c.name === name)
}

function formatArgUsage(arg: ArgSpec): string {
	const core = arg.values ? `${arg.flag} ${arg.values}` : arg.flag
	return arg.required ? core : `[${core}]`
}

function formatSubcommandLine(sub: SubcommandSpec): string {
	const parts: string[] = []
	if (sub.positional) parts.push(sub.positional)
	if (sub.args) parts.push(...sub.args.map(formatArgUsage))
	return parts.join(' ')
}

export function printHelp(json = false): void {
	if (json) {
		printHelpJson()
		return
	}
	printHelpText()
}

function printHelpJson(): void {
	const tree = COMMANDS.map((cmd) => ({
		group: cmd.group,
		name: cmd.name,
		description: cmd.description,
		...(cmd.positional ? { positional: cmd.positional } : {}),
		...(cmd.args ? { args: cmd.args } : {}),
		...(cmd.notes ? { notes: cmd.notes } : {}),
		...(cmd.subcommands
			? {
					subcommands: cmd.subcommands.map((s) => ({
						name: s.name,
						description: s.description,
						...(s.positional ? { positional: s.positional } : {}),
						...(s.args ? { args: s.args } : {}),
						...(s.unavailable ? { unavailable: true } : {}),
						...(s.notes ? { notes: s.notes } : {}),
					})),
				}
			: {}),
	}))

	console.log(
		JSON.stringify(
			{
				name: '1sat',
				version: getVersion(),
				description: 'CLI for 1Sat Ordinals SDK',
				usage: '1sat <command> [subcommand] [options]',
				configDir: '~/.1sat/cli/',
				globalOptions: GLOBAL_OPTIONS,
				envVars: ENV_VARS,
				commands: tree,
			},
			null,
			2,
		),
	)
}

function printHelpText(): void {
	const dim = chalk.dim
	const cyan = chalk.cyan
	const bold = chalk.bold

	const lines: string[] = []
	lines.push('')
	lines.push(`${bold('1sat')} - CLI for 1Sat Ordinals SDK`)
	lines.push('')
	lines.push(bold('Usage:'))
	lines.push('  1sat <command> [subcommand] [options]')
	lines.push('  1sat <command> help            Per-command help')
	lines.push('  1sat help --json              Machine-readable command tree')
	lines.push('')

	let currentGroup = ''
	for (const cmd of COMMANDS) {
		if (cmd.group !== currentGroup) {
			lines.push(bold(`${cmd.group}:`))
			currentGroup = cmd.group
		}
		const head = cmd.subcommands
			? `${cmd.name} <subcommand>`
			: cmd.positional
				? `${cmd.name} ${cmd.positional}`
				: cmd.name
		lines.push(`  ${cyan(head.padEnd(28))} ${dim(cmd.description)}`)

		if (cmd.subcommands) {
			for (const sub of cmd.subcommands) {
				const usage = formatSubcommandLine(sub)
				const label = `${cmd.name} ${sub.name}${usage ? ` ${usage}` : ''}`
				const tag = sub.unavailable ? ' (unavailable)' : ''
				lines.push(
					`    ${cyan(label.padEnd(58))} ${dim(sub.description + tag)}`,
				)
			}
		}
		lines.push('')
	}

	lines.push(bold('Global Options:'))
	for (const opt of GLOBAL_OPTIONS) {
		const usage = opt.values ? `${opt.flag} ${opt.values}` : opt.flag
		lines.push(`  ${dim(usage.padEnd(26))} ${dim(opt.description ?? '')}`)
	}
	lines.push('')

	lines.push(bold('Environment Variables:'))
	for (const env of ENV_VARS) {
		lines.push(`  ${dim(env.name.padEnd(26))} ${dim(env.description)}`)
	}
	lines.push('')

	lines.push(`${bold('Config:')} ~/.1sat/cli/`)
	lines.push('')

	console.log(lines.join('\n'))
}

export function printCommandHelp(commandName: string, json = false): void {
	const spec = getCommand(commandName)
	if (!spec) {
		if (json) {
			console.log(JSON.stringify({ error: `Unknown command: ${commandName}` }))
		} else {
			console.error(`Unknown command: ${commandName}`)
		}
		return
	}

	if (json) {
		console.log(JSON.stringify(spec, null, 2))
		return
	}

	const bold = chalk.bold
	const cyan = chalk.cyan
	const dim = chalk.dim

	console.log()
	console.log(`${bold(`1sat ${spec.name}`)} - ${spec.description}`)
	if (spec.notes) console.log(dim(`  ${spec.notes}`))
	console.log()

	if (spec.subcommands) {
		console.log(bold('Subcommands:'))
		for (const sub of spec.subcommands) {
			const usage = formatSubcommandLine(sub)
			const label = `${sub.name}${usage ? ` ${usage}` : ''}`
			const tag = sub.unavailable ? ' (unavailable)' : ''
			console.log(`  ${cyan(label.padEnd(56))} ${dim(sub.description + tag)}`)
			if (sub.notes) console.log(dim(`    ${sub.notes}`))
		}
		console.log()
	}

	if (spec.args && spec.args.length > 0) {
		console.log(bold('Options:'))
		for (const arg of spec.args) {
			const usage = formatArgUsage(arg)
			console.log(`  ${cyan(usage.padEnd(36))} ${dim(arg.description ?? '')}`)
		}
		console.log()
	}
}
