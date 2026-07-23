/**
 * `1sat serve` command — launch the unified host server and/or monitor.
 *
 *   1sat serve              Host server (storage + hosting + paymail + messagebox) + monitor
 *   1sat serve wallet       Wallet storage server only
 *   1sat serve monitor      Monitor daemon only
 *
 * The server wraps the same wallet instance the CLI uses. Storage, active
 * remote, and backups all come from `~/.1sat/cli/config.json` via the same
 * `createNodeWallet` factory `1sat wallet` commands use.
 *
 * Server-only settings live under `server.*` in the config:
 *   1sat config set server.port 8100
 *   1sat config set server.host 0.0.0.0
 *   1sat config set server.accounts.enabled true
 *   1sat config set server.hosting.enabled true
 *   1sat config set server.paymail.baseUrl https://1sat.app
 *   1sat config set server.monitor.enabled false
 */

import { join } from 'node:path'
import {
	type NodeWalletResult,
	type NodeWalletStorageConfig,
	createNodeWallet,
} from '@1sat/wallet-node'
import {
	KnexPendingStore,
	createHostServer,
	createWalletServer,
} from '@1sat/wallet-server'
import type { PrivateKey } from '@bsv/sdk'
import { initLogger } from 'evlog'
import knexLib from 'knex'
import type { GlobalFlags } from '../args'
import {
	type RepricerConfig,
	type ServerAccountsConfig,
	type ServerMessageboxConfig,
	type ServerStorageConfig,
	loadConfig,
	setConfigPath,
} from '../config'
import { ensureDataDir } from '../config'
import { printCommandHelp } from '../help'
import { loadKey } from '../keys'
import { clearMonitorPid, writeMonitorPid } from '../monitor-lock'
import { fatal } from '../output'
import {
	type RepriceTarget,
	buildPriceUpdateTask,
	createAccountsConfigLoader,
	resolveRateProvider,
} from '../repricer'

const DEFAULT_HOST = '127.0.0.1'
const DEFAULT_PORT = 8100
const DEFAULT_ONESAT_URL = 'https://api.1sat.app/1sat'
const DEFAULT_BASELINE_BYTES = 1024 * 1024 * 1024 // 1 GB
const DEFAULT_PURCHASE_UNIT_BYTES = 1_073_741_824 // 1 GB chunks for production
const DEFAULT_SATS_PER_UNIT = 1_000_000
const DEFAULT_HOSTING_PRICE_SATS = 10_000
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
	repricer?: RepricerConfig
	monitorEnabled: boolean
	privateKey: PrivateKey
}

interface ResolvedAccounts {
	enabled: boolean
	baselineBytes: number
	purchaseUnitBytes: number
	satsPerUnit: number
	durationBlocks: number
	freeIdentityKeys: string[]
	targetUsd?: number
}

export async function handleServeCommand(
	args: string[],
	opts: GlobalFlags,
): Promise<void> {
	const [subcommand] = args
	const mode = resolveMode(subcommand)

	if (mode === null) {
		printCommandHelp('serve', opts.json)
		if (subcommand && subcommand !== 'help') process.exit(1)
		return
	}

	initLogger({ env: { service: `1sat-cli-serve-${mode}` } })

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
		port: resolvePort(server.port),
		onesatURL: DEFAULT_ONESAT_URL,
		storage,
		dataDir,
		sqliteFilename: deriveSqliteFilename(dataDir, chain),
		storageIdentityKey:
			config.storageIdentityKey ?? DEFAULT_STORAGE_IDENTITY_KEY,
		activeRemote: config.activeRemote,
		backups: config.backups,
		accounts: resolveAccounts(server.accounts),
		repricer: server.repricer,
		monitorEnabled: resolveMonitorEnabled(server.monitor?.enabled),
		privateKey,
	}
}

function deriveSqliteFilename(dataDir: string, chain: string): string {
	return join(dataDir, `wallet-${chain}.db`)
}

/**
 * Env beats config, default on. ONESAT_MONITOR=false is set per-process by
 * clustered deployments (PM2 ecosystem) that run a dedicated `serve monitor`;
 * a plain `1sat serve` runs all-in-one.
 */
function resolveMonitorEnabled(configured: boolean | undefined): boolean {
	const fromEnv = process.env.ONESAT_MONITOR
	if (fromEnv && fromEnv.trim() !== '') {
		return !['false', '0', 'off'].includes(fromEnv.trim().toLowerCase())
	}
	return configured !== false
}

function resolvePort(configured: number | undefined): number {
	const fromEnv = process.env.ONESAT_PORT
	if (fromEnv && fromEnv.trim() !== '') {
		const parsed = Number(fromEnv)
		if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 65535) {
			fatal(`ONESAT_PORT must be a valid port number, got: ${fromEnv}`)
		}
		return parsed
	}
	return configured ?? DEFAULT_PORT
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
		targetUsd: accounts?.targetUsd,
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
		// Each serve mode manages monitor work explicitly (see runMonitor
		// below); the factory's initial runOnce is redundant in every case.
		skipInitialMonitor: true,
	})

	// One active monitor per deployment: wallet mode never runs it, monitor
	// mode always does, all mode runs it unless server.monitor.enabled=false
	// (set on redundant host instances that share a dedicated serve monitor).
	const runMonitor =
		mode === 'monitor' || (mode === 'all' && resolved.monitorEnabled)

	const accounts =
		mode === 'monitor'
			? undefined
			: await buildAccountsForServer(resolved, walletResult)

	const serverHandle =
		mode === 'monitor'
			? undefined
			: await startWalletServer(resolved, walletResult, accounts, mode)

	if (runMonitor) {
		const r = resolved.repricer
		const targets: RepriceTarget[] = []
		if (resolved.accounts.enabled && (resolved.accounts.targetUsd ?? 0) > 0) {
			targets.push({
				name: 'accounts',
				targetUsd: resolved.accounts.targetUsd!,
				readCurrentSats: () =>
					loadConfig().server?.accounts?.satsPerUnit ?? DEFAULT_SATS_PER_UNIT,
				onPersist: async (sats) => {
					setConfigPath('server.accounts.satsPerUnit', sats)
				},
			})
		}
		const hostingCfg = loadConfig().server?.hosting
		if (hostingCfg?.enabled === true && (hostingCfg.targetUsd ?? 0) > 0) {
			targets.push({
				name: 'hosting',
				targetUsd: hostingCfg.targetUsd!,
				readCurrentSats: () =>
					loadConfig().server?.hosting?.priceSats ?? DEFAULT_HOSTING_PRICE_SATS,
				onPersist: async (sats) => {
					setConfigPath('server.hosting.priceSats', sats)
				},
			})
		}
		if (r?.enabled && targets.length > 0) {
			walletResult.monitor.addTask(
				buildPriceUpdateTask({
					monitor: walletResult.monitor,
					rateProvider: resolveRateProvider(r.provider ?? 'whatsonchain', {
						chain: resolved.chain,
					}),
					intervalMs: r.intervalMs ?? 15 * 60 * 1000,
					bounds: {
						maxMovePct: r.maxMovePct ?? 25,
						minSats: r.minSats ?? 1,
					},
					targets,
				}),
			)
			console.log(
				`[repricer] enabled — ${targets
					.map((t) => `${t.name} $${t.targetUsd}`)
					.join(', ')} every ${Math.round(
					(r.intervalMs ?? 900_000) / 1000,
				)}s via ${r.provider ?? 'whatsonchain'}`,
			)
		}
	}

	if (runMonitor) {
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
			if (runMonitor) {
				walletResult.monitor.stopTasks()
				clearMonitorPid(resolved.dataDir, process.pid)
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
	mode: ServeMode,
): Promise<{ stop(): Promise<void> }> {
	const config = loadConfig()
	const hostingCfg = config.server?.hosting
	const hostingEnabled = hostingCfg?.enabled === true
	const hosting = hostingEnabled
		? {
				getConfig: () => {
					const h = loadConfig().server?.hosting
					return {
						enabled: h?.enabled === true,
						priceSats: h?.priceSats ?? DEFAULT_HOSTING_PRICE_SATS,
						priceUsd: h?.targetUsd,
						periodSeconds: h?.periodSeconds ?? 2_592_000,
					}
				},
			}
		: undefined

	if (mode === 'wallet') {
		const handle = createWalletServer({
			wallet: walletResult.wallet,
			storage: walletResult.getActiveStorage(),
			serverIdentityKey: walletResult.wallet.identityKey,
			listen: { port: resolved.port, host: resolved.host },
			publicPath: '/',
			internalPath: null,
			accounts: accounts?.walletServerAccounts,
			hosting,
		})
		const port = await handle.start()
		const notes = [
			resolved.accounts.enabled ? 'accounts: on' : '',
			hostingEnabled ? 'hosting: on' : '',
		]
			.filter(Boolean)
			.join(', ')
		console.log(
			`[wallet] listening on ${resolved.host}:${port}${notes ? ` (${notes})` : ''}`,
		)
		return { stop: () => handle.stop() }
	}

	// Unified host: storage + messagebox + paymail + hosting
	const serverCfg = config.server ?? {}
	const paymailCfg = serverCfg.paymail
	const messageboxCfg = serverCfg.messagebox

	const knex = createMessageboxKnex(
		serverCfg.storage ?? { provider: 'bun-sqlite' },
		messageboxCfg,
		resolved,
	)
	const pendingStore = new KnexPendingStore(knex)
	await pendingStore.init()

	const handle = await createHostServer({
		wallet: walletResult.wallet,
		storage: walletResult.getActiveStorage(),
		serverIdentityKey: walletResult.wallet.identityKey,
		listen: { port: resolved.port, host: resolved.host },
		accounts: accounts?.walletServerAccounts,
		hosting,
		paymail: {
			baseUrl:
				paymailCfg?.baseUrl ?? `http://${resolved.host}:${resolved.port}`,
			stackUrl: paymailCfg?.stackUrl ?? 'https://api.1sat.app',
			pendingStore,
			hostWallet: hostingEnabled ? walletResult.wallet : undefined,
			requireEntitlement: hostingEnabled,
			messageboxUrl: `http://127.0.0.1:${resolved.port}/messagebox`,
			hostPrivateKey: resolved.privateKey,
		},
		messagebox: {
			knex,
			websockets: messageboxCfg?.websockets !== false,
		},
	})
	const port = await handle.start()
	const notes = [
		resolved.accounts.enabled ? 'accounts: on' : '',
		hostingEnabled ? 'hosting: on' : '',
	]
		.filter(Boolean)
		.join(', ')
	console.log(
		`[host] listening on ${resolved.host}:${port}${notes ? ` (${notes})` : ''}`,
	)
	return {
		stop: async () => {
			await handle.stop()
			if (knex) await knex.destroy()
		},
	}
}

const DEFAULT_PG_SCHEMA = 'messagebox'

function createMessageboxKnex(
	storage: ServerStorageConfig,
	messagebox: ServerMessageboxConfig | undefined,
	resolved: ResolvedServe,
) {
	if (storage.provider === 'bun-sqlite') {
		const filename =
			messagebox?.dbPath ??
			join(resolved.dataDir, `messagebox-${resolved.chain}.db`)
		return (knexLib as any)({
			client: 'sqlite3',
			connection: { filename },
			useNullAsDefault: true,
		})
	}
	if (storage.provider === 'pg') {
		if (messagebox?.dbUrl) {
			return (knexLib as any)({
				client: 'pg',
				connection: { connectionString: messagebox.dbUrl },
			})
		}
		const schema = messagebox?.pgSchema ?? DEFAULT_PG_SCHEMA
		return (knexLib as any)({
			client: 'pg',
			connection: { connectionString: storage.dbUrl },
			searchPath: [schema],
		})
	}
	fatal(
		`server.storage.provider '${(storage as { provider: string }).provider}' is not supported for messagebox storage.`,
	)
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

	const getConfig = createAccountsConfigLoader({
		ttlMs: 60_000,
		read: () => {
			const fresh = loadConfig()
			const a = fresh.server?.accounts
			return {
				enabled: a?.enabled ?? false,
				baselineBytes: a?.baselineBytes ?? DEFAULT_BASELINE_BYTES,
				purchaseUnitBytes: a?.purchaseUnitBytes ?? DEFAULT_PURCHASE_UNIT_BYTES,
				satsPerUnit: a?.satsPerUnit ?? DEFAULT_SATS_PER_UNIT,
				durationBlocks: a?.durationBlocks ?? DEFAULT_DURATION_BLOCKS,
				freeIdentityKeys: a?.freeIdentityKeys ?? [],
			}
		},
	})

	return {
		walletServerAccounts: {
			getConfig,
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
