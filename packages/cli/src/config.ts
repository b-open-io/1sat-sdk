/**
 * Config management for ~/.1sat/cli/
 *
 * Handles persistent configuration on disk with secure file permissions.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const CONFIG_DIR = join(homedir(), '.1sat', 'cli')
const CONFIG_FILE = join(CONFIG_DIR, 'config.json')

export interface ServerStorageBunSqliteConfig {
	provider: 'bun-sqlite'
}

export interface ServerStoragePgConfig {
	provider: 'pg'
	/** Postgres connection URL (required for pg). */
	dbUrl: string
}

export type ServerStorageConfig =
	| ServerStorageBunSqliteConfig
	| ServerStoragePgConfig

/**
 * Shared repricer engine (`server.repricer`). When enabled, a monitor task
 * fetches the BSV/USD rate on the interval and rewrites each service's sats
 * price toward its own `targetUsd` (`server.accounts.targetUsd` →
 * `satsPerUnit`, `server.hosting.targetUsd` → `priceSats`). Services with no
 * `targetUsd` set are left alone.
 */
export interface RepricerConfig {
	/** Master toggle. Defaults to false. */
	enabled?: boolean
	/** Interval between rate checks in ms. Defaults to 900000 (15 min). */
	intervalMs?: number
	/** Rate provider name. Defaults to "whatsonchain". */
	provider?: string
	/** Max percent change allowed per update. Larger moves are skipped. Defaults to 25. */
	maxMovePct?: number
	/** Lower bound for repriced sats values. Defaults to 1. */
	minSats?: number
}

export interface ServerAccountsConfig {
	/** Master toggle. Defaults to false when omitted. */
	enabled?: boolean
	/** Free baseline per identity key, in bytes. */
	baselineBytes?: number
	/** Purchase chunk size in bytes. Deficits round up to whole chunks. Defaults to 1 GB. */
	purchaseUnitBytes?: number
	/** Sats charged per purchase unit. */
	satsPerUnit?: number
	/** USD target per purchase unit, maintained by `server.repricer`. */
	targetUsd?: number
	/** Block window a payment remains valid for. */
	durationBlocks?: number
	/** Identity keys that bypass metering (server's own key is auto-added). */
	freeIdentityKeys?: string[]
}

export interface ServerMessageboxConfig {
	/** Port to bind. Defaults to `8101`. */
	port?: number
	/** Enable WebSocket delivery. Defaults to `true`. */
	websockets?: boolean
	/**
	 * SQLite file path for messagebox storage. Used only when wallet storage
	 * is `bun-sqlite`. Defaults to `<dataDir>/messagebox-{chain}.db`.
	 */
	dbPath?: string
	/**
	 * Postgres schema for messagebox tables. Used only when wallet storage
	 * is `pg` AND `dbUrl` is unset. Defaults to `messagebox`.
	 */
	pgSchema?: string
	/**
	 * Override Postgres connection URL for messagebox storage. Use this
	 * to point messagebox at a separate Postgres database from the wallet
	 * (recommended — avoids `knex_migrations` table collisions).
	 */
	dbUrl?: string
	/**
	 * Override the wallet storage URL messagebox calls for BRC-31/BRC-29
	 * operations. Defaults to the local wallet server URL (`http://<host>:<port>/`).
	 */
	walletStorageUrl?: string
}

export interface ServerPaymailConfig {
	/** Port to bind. Defaults to `8466` or ONESAT_PAYMAIL_PORT. */
	port?: number
	/**
	 * Public base URL used in /.well-known/bsvalias capability links
	 * (e.g. https://1sat.app). Required for serve paymail.
	 */
	baseUrl?: string
	/** Stack API root (OpNS, beef, tx). Defaults to https://api.1sat.app */
	stackUrl?: string
	/**
	 * SQLite path for in-flight P2P payment references (Go paymail port).
	 * Defaults to `<dataDir>/paymail-pending-{chain}.db`.
	 */
	pendingDbPath?: string
	/**
	 * Messagebox URL for payment_inbox delivery after receive.
	 * Defaults to https://messagebox.1sat.app when unset is OK to skip —
	 * set explicitly to enable (same as Go messagebox_url).
	 */
	messageboxUrl?: string
	/**
	 * When true, open host wallet storage and require active HOSTING_BASKET
	 * receipt for the bound identity. Default false until subscribe path ships.
	 */
	requireEntitlement?: boolean
	/**
	 * Wallet storage URL for entitlement listOutputs (and optional later
	 * subscribe). Defaults to local wallet serve URL like messagebox.
	 */
	walletStorageUrl?: string
}

export interface ServerHostingConfig {
	/** Master toggle. Defaults to false. */
	enabled?: boolean
	/** Sats per subscription period. */
	priceSats?: number
	/**
	 * USD price per subscription period. Returned as `priceUsd` on the
	 * pricing API for display, and maintained as the repricing target for
	 * `priceSats` when `server.repricer` is enabled.
	 */
	targetUsd?: number
	/** Period length in seconds (e.g. 2592000 ≈ 30 days). */
	periodSeconds?: number
}

export interface ServerMonitorConfig {
	/**
	 * Run the background monitor task loop (post waiting txs, check for
	 * proofs, account repricing). Defaults to true. Set false on redundant
	 * host instances that run alongside a dedicated `serve monitor`, so a
	 * single active monitor runs per deployment. `serve monitor` always runs
	 * the loop regardless of this flag.
	 */
	enabled?: boolean
}

export interface ServerConfig {
	/** Hostname to bind. Defaults to `127.0.0.1`. */
	host?: string
	/** Port to bind. Defaults to `8100`. */
	port?: number
	/** Storage backend. Defaults to `{ provider: 'bun-sqlite' }`. */
	storage?: ServerStorageConfig
	/** Optional account/metering layer (opt-in per-deployment). */
	accounts?: ServerAccountsConfig
	/** Messagebox subcommand settings. */
	messagebox?: ServerMessageboxConfig
	/** Paymail subcommand settings. */
	paymail?: ServerPaymailConfig
	/** Hosted paymail subscription (wallet serve /hosting/*). */
	hosting?: ServerHostingConfig
	/** Shared BSV/USD repricer engine for accounts + hosting prices. */
	repricer?: RepricerConfig
	/** Background monitor task loop. Defaults to enabled. */
	monitor?: ServerMonitorConfig
}

export interface OneSatCliConfig {
	/** Network: mainnet or testnet */
	chain: 'main' | 'test'
	/** Data directory for wallet databases */
	dataDir: string
	/** Primary remote storage URL (active or backup) */
	activeRemote?: string
	/** Backup remote storage URLs */
	backups?: string[]
	/** Storage identity key for wallet persistence */
	storageIdentityKey?: string
	/** Settings read by `1sat serve` subcommands. Absent for client-only installs. */
	server?: ServerConfig
}

const DEFAULT_CONFIG: OneSatCliConfig = {
	chain: 'main',
	dataDir: join(CONFIG_DIR, 'data'),
}

/**
 * Ensure ~/.1sat/cli/ exists with secure permissions.
 */
export function ensureConfigDir(): void {
	if (!existsSync(CONFIG_DIR)) {
		mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 })
	}
}

/**
 * Load config from disk. Returns defaults if file doesn't exist.
 */
export function loadConfig(): OneSatCliConfig {
	if (!existsSync(CONFIG_FILE)) return { ...DEFAULT_CONFIG }
	try {
		const raw = readFileSync(CONFIG_FILE, 'utf8')
		const parsed = JSON.parse(raw)
		return { ...DEFAULT_CONFIG, ...parsed }
	} catch {
		return { ...DEFAULT_CONFIG }
	}
}

/**
 * Save config to disk with secure permissions.
 */
export function saveConfig(config: OneSatCliConfig): void {
	ensureConfigDir()
	writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), {
		mode: 0o600,
	})
}

/**
 * Update specific config fields, preserving the rest.
 */
export function updateConfig(patch: Partial<OneSatCliConfig>): OneSatCliConfig {
	const config = loadConfig()
	const next = { ...config, ...patch }
	saveConfig(next)
	return next
}

/**
 * Set a value at a dotted path inside the config, creating intermediate
 * objects as needed. `value` is stored as-is; callers are responsible for
 * type coercion (typically via `parseConfigValue`).
 */
export function setConfigPath(path: string, value: unknown): OneSatCliConfig {
	if (!path) throw new Error('setConfigPath requires a non-empty path')
	const config = loadConfig() as Record<string, unknown>
	const segments = path.split('.')
	let cursor: Record<string, unknown> = config
	for (let i = 0; i < segments.length - 1; i++) {
		const key = segments[i]
		const existing = cursor[key]
		if (
			existing == null ||
			typeof existing !== 'object' ||
			Array.isArray(existing)
		) {
			cursor[key] = {}
		}
		cursor = cursor[key] as Record<string, unknown>
	}
	cursor[segments[segments.length - 1]] = value
	saveConfig(config as OneSatCliConfig)
	return config as OneSatCliConfig
}

/**
 * Remove a value at a dotted path. Leaves empty parent objects in place to
 * keep the file shape explicit.
 */
export function unsetConfigPath(path: string): OneSatCliConfig {
	if (!path) throw new Error('unsetConfigPath requires a non-empty path')
	const config = loadConfig() as Record<string, unknown>
	const segments = path.split('.')
	let cursor: Record<string, unknown> | undefined = config
	for (let i = 0; i < segments.length - 1; i++) {
		const next = cursor?.[segments[i]]
		if (next == null || typeof next !== 'object')
			return config as OneSatCliConfig
		cursor = next as Record<string, unknown>
	}
	if (cursor) delete cursor[segments[segments.length - 1]]
	saveConfig(config as OneSatCliConfig)
	return config as OneSatCliConfig
}

/**
 * Parse a raw CLI argument into a typed JSON value. Tries `JSON.parse`
 * first so numbers, booleans, objects and arrays round-trip naturally;
 * falls back to the raw string for bare words that aren't valid JSON.
 */
export function parseConfigValue(raw: string): unknown {
	try {
		return JSON.parse(raw)
	} catch {
		return raw
	}
}

/**
 * Get the config directory path.
 */
export function getConfigDir(): string {
	return CONFIG_DIR
}

/**
 * Get the config file path.
 */
export function getConfigFile(): string {
	return CONFIG_FILE
}

/**
 * Get the data directory, ensuring it exists.
 */
export function ensureDataDir(): string {
	const config = loadConfig()
	const dataDir = config.dataDir
	if (!existsSync(dataDir)) {
		mkdirSync(dataDir, { recursive: true, mode: 0o700 })
	}
	return dataDir
}
