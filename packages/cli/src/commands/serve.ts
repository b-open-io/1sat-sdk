/**
 * `1sat serve` command — launch wallet server and/or monitor.
 *
 *   1sat serve             Wallet server + monitor daemon
 *   1sat serve wallet      Wallet server only
 *   1sat serve monitor     Monitor daemon only
 *
 * The server wraps the same wallet instance the CLI uses. Storage, active
 * remote, and backups all come from `~/.1sat/cli/config.json` via the same
 * `createNodeWallet` factory `1sat wallet` commands use.
 *
 * Server-only settings live under `server.*` in the config:
 *   1sat config set server.port 8100
 *   1sat config set server.host 0.0.0.0
 *   1sat config set server.accounts.enabled true
 */

import { join } from 'node:path'
import { OneSatServices } from '@1sat/client'
import { type NodeWalletResult, createNodeWallet } from '@1sat/wallet-node'
import {
	createWalletServer,
	runMigrations as runAccountsMigrations,
} from '@1sat/wallet-server'
import type { PrivateKey } from '@bsv/sdk'
import { type Knex, knex } from 'knex'
import type { GlobalFlags } from '../args'
import {
	type ServerAccountsConfig,
	type ServerStorageConfig,
	loadConfig,
} from '../config'
import { ensureDataDir } from '../config'
import { printCommandHelp } from '../help'
import { loadKey, resolvePassword } from '../keys'
import { fatal } from '../output'

const DEFAULT_HOST = '127.0.0.1'
const DEFAULT_PORT = 8100
const DEFAULT_ONESAT_URL = 'https://api.1sat.app/1sat'
const DEFAULT_BASELINE_BYTES = 1024 * 1024 * 1024 // 1 GB
const DEFAULT_SATS_PER_GB = 1_000_000
const DEFAULT_DURATION_BLOCKS = 4383
const DEFAULT_STORAGE_IDENTITY_KEY = '1sat-cli-default'

type ServeMode = 'all' | 'wallet' | 'monitor'

interface ResolvedServe {
	chain: 'main' | 'test'
	host: string
	port: number
	onesatURL: string
	storage: ServerStorageConfig
	dataDir: string
	sqliteFilename: string
	storageIdentityKey: string
	activeRemote?: string
	backups?: string[]
	accounts: ResolvedAccounts
	privateKey: PrivateKey
}

interface ResolvedAccounts {
	enabled: boolean
	baselineBytes: number
	satsPerGb: number
	durationBlocks: number
	freeIdentityKeys: string[]
}

export async function handleServeCommand(
	args: string[],
	opts: GlobalFlags,
): Promise<void> {
	const [subcommand] = args
	const mode = resolveMode(subcommand)

	if (mode === null) {
		printCommandHelp('serve', {
			'(no subcommand)': 'Wallet server plus monitor daemon',
			wallet: 'Wallet server only',
			monitor: 'Monitor daemon only',
		})
		if (subcommand && subcommand !== 'help') process.exit(1)
		return
	}

	const resolved = await resolveServe(opts)
	const handles: Stoppable[] = []

	try {
		if (resolved.storage.provider === 'bun-sqlite') {
			handles.push(await runBunSqlite(resolved, mode))
		} else {
			fatal(
				`server.storage.provider '${resolved.storage.provider}' is not yet wired through the shared wallet factory. Only bun-sqlite is supported at the moment.`,
			)
		}

		await waitForShutdown()
	} finally {
		for (const h of handles.reverse()) {
			try {
				await h.stop()
			} catch (err) {
				console.error(`Error during shutdown: ${(err as Error).message}`)
			}
		}
	}
}

function resolveMode(subcommand: string | undefined): ServeMode | null {
	if (!subcommand) return 'all'
	switch (subcommand) {
		case 'wallet':
		case 'monitor':
			return subcommand
		default:
			return null
	}
}

/**
 * Load the CLI config, apply serve defaults, and resolve the server identity
 * key via the existing keyring mechanism.
 */
async function resolveServe(opts: GlobalFlags): Promise<ResolvedServe> {
	const config = loadConfig()
	const server = config.server ?? {}

	const storage: ServerStorageConfig = server.storage ?? {
		provider: 'bun-sqlite',
	}
	if (storage.provider === 'knex-pg' && !storage.dbUrl) {
		fatal(
			'server.storage.provider is knex-pg but server.storage.dbUrl is not set. ' +
				'Set it with: 1sat config set server.storage.dbUrl postgres://…',
		)
	}

	const dataDir = ensureDataDir()
	const chain = opts.chain ?? config.chain ?? 'main'

	let privateKey: PrivateKey
	try {
		privateKey = await loadKey(resolvePassword())
	} catch (err) {
		fatal((err as Error).message)
	}

	return {
		chain,
		host: server.host ?? DEFAULT_HOST,
		port: server.port ?? DEFAULT_PORT,
		onesatURL: DEFAULT_ONESAT_URL,
		storage,
		dataDir,
		sqliteFilename: deriveSqliteFilename(dataDir, chain),
		storageIdentityKey:
			config.storageIdentityKey ?? DEFAULT_STORAGE_IDENTITY_KEY,
		activeRemote: config.activeRemote,
		backups: config.backups,
		accounts: resolveAccounts(server.accounts),
		privateKey,
	}
}

function deriveSqliteFilename(dataDir: string, chain: string): string {
	return join(dataDir, `wallet-${chain}.db`)
}

function resolveAccounts(accounts?: ServerAccountsConfig): ResolvedAccounts {
	return {
		enabled: accounts?.enabled ?? false,
		baselineBytes: accounts?.baselineBytes ?? DEFAULT_BASELINE_BYTES,
		satsPerGb: accounts?.satsPerGb ?? DEFAULT_SATS_PER_GB,
		durationBlocks: accounts?.durationBlocks ?? DEFAULT_DURATION_BLOCKS,
		freeIdentityKeys: accounts?.freeIdentityKeys ?? [],
	}
}

interface Stoppable {
	stop(): Promise<void>
}

/**
 * bun-sqlite path: construct the wallet via the same `createNodeWallet`
 * factory the CLI uses. Server + monitor operate on that single wallet
 * instance, so `activeRemote`, `backups`, and `storageIdentityKey` behave
 * identically to `1sat wallet <command>`.
 */
async function runBunSqlite(
	resolved: ResolvedServe,
	mode: ServeMode,
): Promise<Stoppable> {
	const walletResult = await createNodeWallet({
		privateKey: resolved.privateKey,
		chain: resolved.chain,
		storageIdentityKey: resolved.storageIdentityKey,
		filename: resolved.sqliteFilename,
		activeRemote: resolved.activeRemote,
		backups: resolved.backups,
	})

	const accounts = await buildAccountsForServer(resolved)

	const serverHandle =
		mode === 'monitor'
			? undefined
			: await startWalletServer(resolved, walletResult, accounts)

	if (mode !== 'wallet') {
		await walletResult.monitor.startTasks()
		console.log('[monitor] started')
	}

	return {
		async stop() {
			if (mode !== 'wallet') {
				walletResult.monitor.stopTasks()
			}
			if (serverHandle) await serverHandle.stop()
			if (accounts) await accounts.knex.destroy()
			await walletResult.destroy()
		},
	}
}

async function startWalletServer(
	resolved: ResolvedServe,
	walletResult: NodeWalletResult,
	accounts: AccountsRuntime | undefined,
): Promise<{ stop(): Promise<void> }> {
	const handle = createWalletServer({
		storage: walletResult.storage,
		serverPrivateKey: resolved.privateKey.toHex(),
		listen: { port: resolved.port, host: resolved.host },
		publicPath: '/',
		internalPath: null,
		accounts: accounts?.walletServerAccounts,
	})
	const port = await handle.start()
	const accountsNote = resolved.accounts.enabled ? ' (accounts: on)' : ''
	console.log(`[wallet] listening on ${resolved.host}:${port}${accountsNote}`)
	return { stop: () => handle.stop() }
}

interface AccountsRuntime {
	walletServerAccounts: NonNullable<
		Parameters<typeof createWalletServer>[0]['accounts']
	>
	knex: Knex
}

async function buildAccountsForServer(
	resolved: ResolvedServe,
): Promise<AccountsRuntime | undefined> {
	if (!resolved.accounts.enabled) return undefined

	// Accounts uses its own knex pool. For bun-sqlite wallets that means
	// opening the same file via better-sqlite3; for future pg wallets it
	// shares the pg connection. Always a file path for now.
	const accountsKnex = knex({
		client: 'better-sqlite3',
		connection: { filename: resolved.sqliteFilename },
		useNullAsDefault: true,
	})
	await runAccountsMigrations(accountsKnex)

	const services = new OneSatServices(resolved.chain, resolved.onesatURL)

	return {
		knex: accountsKnex,
		walletServerAccounts: {
			config: {
				enabled: true,
				baselineBytes: resolved.accounts.baselineBytes,
				satsPerGb: resolved.accounts.satsPerGb,
				durationBlocks: resolved.accounts.durationBlocks,
				freeIdentityKeys: resolved.accounts.freeIdentityKeys,
			},
			knex: accountsKnex,
			currentBlock: () => services.chaintracks.currentHeight(),
		},
	}
}

function waitForShutdown(): Promise<void> {
	return new Promise((resolve) => {
		const handler = (sig: string) => {
			console.log(`Received ${sig}, shutting down...`)
			resolve()
		}
		process.once('SIGINT', () => handler('SIGINT'))
		process.once('SIGTERM', () => handler('SIGTERM'))
	})
}
