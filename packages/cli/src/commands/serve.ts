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
import {
	type NodeWalletResult,
	type NodeWalletStorageConfig,
	createNodeWallet,
} from '@1sat/wallet-node'
import { createWalletServer } from '@1sat/wallet-server'
import type { PrivateKey } from '@bsv/sdk'
import type { GlobalFlags } from '../args'
import {
	type ServerAccountsConfig,
	type ServerStorageConfig,
	loadConfig,
} from '../config'
import { ensureDataDir } from '../config'
import { printCommandHelp } from '../help'
import { loadKey } from '../keys'
import { clearMonitorPid, writeMonitorPid } from '../monitor-lock'
import { fatal } from '../output'

const DEFAULT_HOST = '127.0.0.1'
const DEFAULT_PORT = 8100
const DEFAULT_ONESAT_URL = 'https://api.1sat.app/1sat'
const DEFAULT_BASELINE_BYTES = 1024 * 1024 * 1024 // 1 GB
const DEFAULT_PURCHASE_UNIT_BYTES = 1_073_741_824 // 1 GB chunks for production
const DEFAULT_SATS_PER_UNIT = 1_000_000
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
	purchaseUnitBytes: number
	satsPerUnit: number
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
		handles.push(await runWithStorage(resolved, mode))
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
	if (storage.provider === 'pg' && !storage.dbUrl) {
		fatal(
			'server.storage.provider is pg but server.storage.dbUrl is not set. ' +
				'Set it with: 1sat config set server.storage.dbUrl postgres://…',
		)
	}

	const dataDir = ensureDataDir()
	const chain = opts.chain ?? config.chain ?? 'main'

	let privateKey: PrivateKey
	try {
		privateKey = await loadKey()
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

function resolveWalletStorageConfig(
	resolved: ResolvedServe,
): NodeWalletStorageConfig {
	const storage = resolved.storage
	if (storage.provider === 'bun-sqlite') {
		return { provider: 'bun-sqlite', filename: resolved.sqliteFilename }
	}
	if (storage.provider === 'pg') {
		return { provider: 'pg', dbUrl: storage.dbUrl }
	}
	fatal(
		`server.storage.provider '${storage.provider}' is not supported. Use 'bun-sqlite' or 'pg'.`,
	)
}

function resolveAccounts(accounts?: ServerAccountsConfig): ResolvedAccounts {
	return {
		enabled: accounts?.enabled ?? false,
		baselineBytes: accounts?.baselineBytes ?? DEFAULT_BASELINE_BYTES,
		purchaseUnitBytes:
			accounts?.purchaseUnitBytes ?? DEFAULT_PURCHASE_UNIT_BYTES,
		satsPerUnit: accounts?.satsPerUnit ?? DEFAULT_SATS_PER_UNIT,
		durationBlocks: accounts?.durationBlocks ?? DEFAULT_DURATION_BLOCKS,
		freeIdentityKeys: accounts?.freeIdentityKeys ?? [],
	}
}

interface Stoppable {
	stop(): Promise<void>
}

/**
 * Construct the wallet via the same `createNodeWallet` factory the CLI
 * uses, with storage provider (bun-sqlite / pg) chosen from config.
 * Server + monitor operate on that single wallet instance, so
 * `activeRemote`, `backups`, and `storageIdentityKey` behave identically
 * to `1sat wallet <command>`.
 */
async function runWithStorage(
	resolved: ResolvedServe,
	mode: ServeMode,
): Promise<Stoppable> {
	const storage = resolveWalletStorageConfig(resolved)
	const walletResult = await createNodeWallet({
		privateKey: resolved.privateKey,
		chain: resolved.chain,
		storageIdentityKey: resolved.storageIdentityKey,
		storage,
		activeRemote: resolved.activeRemote,
		backups: resolved.backups,
		// Server owns the monitor loop; suppress the factory's initial
		// runOnce so CLI invocations in the same data dir don't race with it.
		skipInitialMonitor: mode !== 'wallet',
	})

	const accounts =
		mode === 'monitor'
			? undefined
			: await buildAccountsForServer(resolved, walletResult)

	const serverHandle =
		mode === 'monitor'
			? undefined
			: await startWalletServer(resolved, walletResult, accounts)

	if (mode !== 'wallet') {
		// startTasks loops until stopTasks flips its flag. Fire without
		// awaiting so the caller can install shutdown handlers and write
		// the monitor pid file.
		walletResult.monitor.startTasks().catch((err: unknown) => {
			console.error('[monitor] task loop exited:', err)
		})
		writeMonitorPid(resolved.dataDir)
		console.log('[monitor] started')
	}

	return {
		async stop() {
			if (mode !== 'wallet') {
				walletResult.monitor.stopTasks()
				clearMonitorPid(resolved.dataDir)
			}
			if (serverHandle) await serverHandle.stop()
			// Accounts shares the wallet's connection — walletResult.destroy
			// below closes it. No separate teardown needed.
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
		wallet: walletResult.wallet,
		storage: walletResult.getActiveStorage(),
		serverIdentityKey: walletResult.wallet.identityKey,
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
}

async function buildAccountsForServer(
	resolved: ResolvedServe,
	walletResult: NodeWalletResult,
): Promise<AccountsRuntime | undefined> {
	// When the wallet is remote-primary the server is fronting someone else's
	// storage; accounts semantics don't apply.
	if (resolved.activeRemote) return undefined

	return {
		walletServerAccounts: {
			config: {
				enabled: resolved.accounts.enabled,
				baselineBytes: resolved.accounts.baselineBytes,
				purchaseUnitBytes: resolved.accounts.purchaseUnitBytes,
				satsPerUnit: resolved.accounts.satsPerUnit,
				durationBlocks: resolved.accounts.durationBlocks,
				freeIdentityKeys: resolved.accounts.freeIdentityKeys,
			},
			currentBlock: () => walletResult.services.chaintracks.currentHeight(),
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
