/**
 * `1sat serve messagebox` — launch the BSV message-box server using the
 * CLI's wallet identity.
 *
 * messagebox-server boots itself as a side effect of `import` once env vars
 * are populated, so this handler:
 *   1. Reads CLI config + private key
 *   2. Composes env (SERVER_PRIVATE_KEY, PORT, KNEX_DB_*, WALLET_STORAGE_URL, …)
 *   3. Switches cwd to the messagebox-server install dir so its knexfile's
 *      relative `./out/src/migrations` path resolves correctly
 *   4. Dynamically imports `@bopen-io/messagebox-server`
 *   5. Awaits SIGINT/SIGTERM, then closes the HTTP and WebSocket servers
 */

import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { PrivateKey } from '@bsv/sdk'
import type { GlobalFlags } from '../args'
import {
	type ServerMessageboxConfig,
	type ServerStorageConfig,
	ensureDataDir,
	loadConfig,
} from '../config'
import { loadKey } from '../keys'
import { fatal } from '../output'

const DEFAULT_MESSAGEBOX_PORT = 8771
const DEFAULT_WALLET_HOST = '127.0.0.1'
const DEFAULT_WALLET_PORT = 8100
const DEFAULT_PG_SCHEMA = 'messagebox'

interface ResolvedMessagebox {
	chain: 'main' | 'test'
	port: number
	websockets: boolean
	walletStorageUrl: string
	knexClient: string
	knexConnection: Record<string, unknown>
	identityHex: string
	identityPub: string
}

interface MessageboxModule {
	http: { close(cb?: (err?: Error) => void): void }
	io: { close(cb?: () => void): void } | null
}

export interface MessageboxStoppable {
	stop(): Promise<void>
}

export async function startMessagebox(
	opts: GlobalFlags,
): Promise<MessageboxStoppable> {
	const resolved = await resolveMessagebox(opts)
	applyEnv(resolved)

	console.log(`[messagebox] starting on 0.0.0.0:${resolved.port}`)
	console.log(`[messagebox] identity: ${resolved.identityPub.slice(0, 16)}…`)
	console.log(`[messagebox] storage: ${resolved.knexClient}`)
	console.log(`[messagebox] wallet:  ${resolved.walletStorageUrl}`)
	console.log(
		`[messagebox] websockets: ${resolved.websockets ? 'enabled' : 'disabled'}`,
	)

	// messagebox-server's knexfile uses `./out/src/migrations` relative to
	// cwd. Switch cwd to its install dir so that path resolves correctly
	// regardless of where the CLI was invoked from.
	const packageJsonUrl = import.meta.resolve(
		'@bopen-io/messagebox-server/package.json',
	)
	const messageboxDir = dirname(fileURLToPath(packageJsonUrl))
	process.chdir(messageboxDir)

	// messagebox-server boots itself when its index module is loaded.
	const mbox = (await import(
		'@bopen-io/messagebox-server'
	)) as unknown as MessageboxModule

	return {
		async stop() {
			await new Promise<void>((resolve) => {
				try {
					mbox.http.close(() => resolve())
				} catch {
					resolve()
				}
			})
			if (mbox.io) {
				await new Promise<void>((resolve) => {
					try {
						mbox.io?.close(() => resolve())
					} catch {
						resolve()
					}
				})
			}
		},
	}
}

async function resolveMessagebox(
	opts: GlobalFlags,
): Promise<ResolvedMessagebox> {
	const config = loadConfig()
	const server = config.server ?? {}
	const messagebox: ServerMessageboxConfig = server.messagebox ?? {}

	const chain = opts.chain ?? config.chain ?? 'main'
	const port = resolvePort(messagebox.port)
	const websockets = messagebox.websockets !== false

	let privateKey: PrivateKey
	try {
		privateKey = await loadKey()
	} catch (err) {
		fatal((err as Error).message)
	}

	const identityHex = privateKey.toString()
	const identityPub = privateKey.toPublicKey().toString()

	const walletHost = server.host ?? DEFAULT_WALLET_HOST
	const walletPort = server.port ?? DEFAULT_WALLET_PORT
	const walletStorageUrl =
		messagebox.walletStorageUrl ?? `http://${walletHost}:${walletPort}/`

	const { knexClient, knexConnection } = resolveStorage(
		server.storage ?? { provider: 'bun-sqlite' },
		messagebox,
		chain,
	)

	return {
		chain,
		port,
		websockets,
		walletStorageUrl,
		knexClient,
		knexConnection,
		identityHex,
		identityPub,
	}
}

function resolvePort(configured: number | undefined): number {
	const fromEnv = process.env.ONESAT_MESSAGEBOX_PORT
	if (fromEnv && fromEnv.trim() !== '') {
		const parsed = Number(fromEnv)
		if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 65535) {
			fatal(
				`ONESAT_MESSAGEBOX_PORT must be a valid port number, got: ${fromEnv}`,
			)
		}
		return parsed
	}
	return configured ?? DEFAULT_MESSAGEBOX_PORT
}

function resolveStorage(
	storage: ServerStorageConfig,
	messagebox: ServerMessageboxConfig,
	chain: 'main' | 'test',
): { knexClient: string; knexConnection: Record<string, unknown> } {
	if (storage.provider === 'bun-sqlite') {
		const dataDir = ensureDataDir()
		const filename =
			messagebox.dbPath ?? join(dataDir, `messagebox-${chain}.db`)
		return {
			knexClient: 'sqlite3',
			knexConnection: { filename },
		}
	}

	if (storage.provider === 'pg') {
		// Prefer a dedicated messagebox database when configured (recommended:
		// avoids `knex_migrations` table collisions with wallet-toolbox).
		// Fall back to schema isolation against the wallet's database — note
		// the `messagebox` schema must exist in that database for table
		// creation to land there instead of `public`.
		if (messagebox.dbUrl) {
			return {
				knexClient: 'pg',
				knexConnection: { connectionString: messagebox.dbUrl },
			}
		}
		const schema = messagebox.pgSchema ?? DEFAULT_PG_SCHEMA
		return {
			knexClient: 'pg',
			knexConnection: {
				connectionString: storage.dbUrl,
				searchPath: [schema, 'public'],
			},
		}
	}

	fatal(
		`server.storage.provider '${(storage as { provider: string }).provider}' is not supported by 'serve messagebox'.`,
	)
}

function applyEnv(resolved: ResolvedMessagebox): void {
	// messagebox-server reads env at module-load time, so we set everything
	// before the dynamic import. dotenv.config() inside messagebox-server
	// does not overwrite values already set on process.env.
	process.env.SERVER_PRIVATE_KEY = resolved.identityHex
	process.env.BSV_NETWORK = resolved.chain === 'main' ? 'mainnet' : 'testnet'
	process.env.PORT = String(resolved.port)
	// messagebox-server's index.ts forces HTTP_PORT=3000 when NODE_ENV
	// is anything other than 'development', ignoring our PORT entirely.
	// Use 'development' so PORT is honored.
	process.env.NODE_ENV = 'development'
	process.env.ENABLE_WEBSOCKETS = resolved.websockets ? 'true' : 'false'
	process.env.WALLET_STORAGE_URL = resolved.walletStorageUrl
	process.env.KNEX_DB_CLIENT = resolved.knexClient
	process.env.KNEX_DB_CONNECTION = JSON.stringify(resolved.knexConnection)
	if (process.env.ENABLE_FIREBASE === undefined) {
		process.env.ENABLE_FIREBASE = 'false'
	}
}
