/**
 * Config management for ~/.1sat/
 *
 * Handles persistent configuration on disk with secure file permissions.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const CONFIG_DIR = join(homedir(), '.1sat')
const CONFIG_FILE = join(CONFIG_DIR, 'config.json')

export interface OneSatCliConfig {
	/** Network: mainnet or testnet */
	chain: 'main' | 'test'
	/** Data directory for wallet databases */
	dataDir: string
	/** Remote storage URL for wallet backup */
	remoteStorageUrl?: string
	/** Storage identity key for wallet persistence */
	storageIdentityKey?: string
}

const DEFAULT_CONFIG: OneSatCliConfig = {
	chain: 'main',
	dataDir: join(CONFIG_DIR, 'data'),
}

/**
 * Ensure ~/.1sat/ exists with secure permissions.
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
