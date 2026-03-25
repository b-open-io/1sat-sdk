/**
 * 1sat-stack sidecar process manager.
 *
 * Spawns the 1sat-stack Go binary as a child process alongside the wallet.
 * Provides local blockchain indexing and ORDFS content serving at
 * http://127.0.0.1:8080.
 *
 * Binary discovery order (dev → prod):
 *   1. ~/code/1sat-stack/server  (pre-compiled dev binary)
 *   2. Compile on-the-fly from ~/code/1sat-stack via `go build`
 *   3. <app bundle>/Resources/1sat-stack  (production — postBuild copies it)
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import type { Subprocess } from 'bun'
import { createLogger } from 'evlog'

// ============================================================================
// Constants
// ============================================================================

const STACK_PORT = 8080
const STACK_HOST = '127.0.0.1'
const STACK_URL = `http://${STACK_HOST}:${STACK_PORT}`

const DEV_BINARY = `${process.env.HOME}/code/1sat-stack/server`
const DEV_SOURCE_DIR = `${process.env.HOME}/code/1sat-stack`

// ============================================================================
// Module state
// ============================================================================

let stackProcess: Subprocess | undefined

// ============================================================================
// Config generation
// ============================================================================

/**
 * Generate a minimal config.yaml.
 *
 * Only the bare minimum to start the server with admin UI working.
 * The admin wizard handles all other configuration at runtime.
 * Arcade teranode URLs are required for the wallet service to init,
 * which is required for the auth middleware, which is required for admin routes.
 */
function buildConfig(_dataDir: string): string {
	return `# 1sat-stack — minimal config for desktop sidecar
# Everything else configured through the admin UI at /1sat/admin
network: main

server:
  port: ${STACK_PORT}
  host: ${STACK_HOST}

junglebus:
  url: https://junglebus.gorillapool.io

chaintracks:
  bootstrap_url: https://mainnet.gorillanode.io/api/v1

arcade:
  teranode:
    broadcast_urls:
      - https://teranode-eks-mainnet-eu-1-propagation.bsvb.tech
    datahub_urls:
      - https://teranode-eks-mainnet-eu-1.bsvb.tech/api/v1
`
}

// ============================================================================
// Binary discovery
// ============================================================================

/**
 * Find the 1sat-stack server binary.
 *
 * Throws with a clear message if no binary can be found or compiled,
 * rather than silently falling back to an undefined path.
 */
async function findServerBinary(): Promise<string> {
	const log = createLogger({ context: 'stack' })
	const { resolve } = await import('node:path')

	// 1. Pre-compiled dev binary
	log.set({ event: 'binary_search', candidate: 'dev', path: DEV_BINARY, exists: existsSync(DEV_BINARY) })
	log.emit()
	if (existsSync(DEV_BINARY)) {
		return DEV_BINARY
	}

	// 2. Compile from source if source tree is present
	const mainGo = `${DEV_SOURCE_DIR}/cmd/server/main.go`
	log.set({ event: 'binary_search', candidate: 'source', path: mainGo, exists: existsSync(mainGo) })
	log.emit()
	if (existsSync(mainGo)) {
		const outPath = '/tmp/1sat-stack-server'
		const proc = Bun.spawn(
			['go', 'build', '-o', outPath, './cmd/server'],
			{ cwd: DEV_SOURCE_DIR, stdout: 'inherit', stderr: 'inherit' },
		)
		const exitCode = await proc.exited
		if (exitCode !== 0) {
			throw new Error(`1sat-stack: go build failed with exit code ${exitCode}`)
		}
		return outPath
	}

	// 3. Production bundle — postBuild copies into MacOS/ alongside the main binary
	const bundledPath = resolve(process.argv0, '..', '1sat-stack')
	log.set({
		event: 'binary_search',
		candidate: 'bundled',
		path: bundledPath,
		argv0: process.argv0,
		exists: existsSync(bundledPath),
	})
	log.emit()
	if (existsSync(bundledPath)) {
		return bundledPath
	}

	const error = `1sat-stack binary not found. Checked: ${DEV_BINARY}, ${mainGo}, ${bundledPath}`
	log.set({ event: 'binary_not_found', error, argv0: process.argv0 })
	log.emit()
	throw new Error(error)
}

// ============================================================================
// Log forwarding
// ============================================================================

async function forwardStream(
	stream: ReadableStream<Uint8Array>,
	prefix: string,
): Promise<void> {
	const decoder = new TextDecoder()
	const reader = stream.getReader()
	try {
		while (true) {
			const { done, value } = await reader.read()
			if (done) break
			const text = decoder.decode(value, { stream: true }).trimEnd()
			if (text) {
				console.log(`[${prefix}] ${text}`)
			}
		}
	} finally {
		reader.releaseLock()
	}
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Start the 1sat-stack sidecar process.
 * No-ops if already running.
 */
export async function startStack(): Promise<void> {
	const log = createLogger({ context: 'stack' })

	if (stackProcess && !stackProcess.killed) {
		log.set({ event: 'already_running', pid: stackProcess.pid })
		log.emit()
		return
	}

	// Check if something is already running on the stack port
	try {
		const res = await fetch(`http://${STACK_HOST}:${STACK_PORT}/1sat/health`, {
			signal: AbortSignal.timeout(1000),
		})
		if (res.ok) {
			log.set({ event: 'external_instance', port: STACK_PORT })
			log.emit()
			return
		}
	} catch {
		// Not running — proceed to start
	}

	const dataDir = `${process.env.HOME}/.1sat-wallet/stack`
	const configPath = `${dataDir}/config.yaml`

	mkdirSync(dataDir, { recursive: true })

	if (!existsSync(configPath)) {
		writeFileSync(configPath, buildConfig(dataDir), 'utf8')
		log.set({ event: 'config_written', path: configPath })
		log.emit()
	}

	let serverPath: string
	try {
		serverPath = await findServerBinary()
		log.set({ event: 'binary_found', path: serverPath })
		log.emit()
	} catch (err) {
		log.set({ event: 'start_failed', error: err instanceof Error ? err.message : String(err) })
		log.emit()
		throw err
	}

	stackProcess = Bun.spawn([serverPath, '-config', configPath], {
		stdout: 'pipe',
		stderr: 'pipe',
		cwd: dataDir,
		env: {
			...process.env,
			ONESAT_DATA_DIR: dataDir,
		},
	})

	log.set({ event: 'spawned', pid: stackProcess.pid, path: serverPath, port: STACK_PORT })
	log.emit()

	// Forward stdout/stderr without blocking the caller
	forwardStream(stackProcess.stdout, '1sat-stack').catch((err) => {
		const errLog = createLogger({ context: 'stack' })
		errLog.set({ event: 'stdout_error', error: err instanceof Error ? err.message : String(err) })
		errLog.emit()
	})
	forwardStream(stackProcess.stderr, '1sat-stack:err').catch((err) => {
		const errLog = createLogger({ context: 'stack' })
		errLog.set({ event: 'stderr_error', error: err instanceof Error ? err.message : String(err) })
		errLog.emit()
	})

	// Monitor for early exit
	stackProcess.exited.then((code) => {
		const exitLog = createLogger({ context: 'stack' })
		exitLog.set({ event: 'exited', exitCode: code, pid: stackProcess?.pid })
		exitLog.emit()
		if (code !== 0) {
			console.error(`1sat-stack exited with code ${code}`)
		}
	})

	console.log(
		`1sat-stack started on port ${STACK_PORT} (PID: ${stackProcess.pid})`,
	)
}

/**
 * Stop the 1sat-stack sidecar process with SIGTERM.
 */
export function stopStack(): void {
	if (stackProcess && !stackProcess.killed) {
		stackProcess.kill('SIGTERM')
		console.log('1sat-stack stopped')
	}
	stackProcess = undefined
}

/**
 * Returns true if the sidecar process is currently running.
 */
export function isStackRunning(): boolean {
	// Check both our own process and any external instance on the port
	if (stackProcess && !stackProcess.killed) return true
	try {
		// Synchronous check not possible — callers should use isStackSetupComplete() for async check
		return false
	} catch {
		return false
	}
}

/**
 * Base URL for the local 1sat-stack HTTP API and ORDFS content server.
 */
export function getStackUrl(): string {
	return STACK_URL
}

/**
 * Check if the 1sat-stack setup wizard has been completed.
 * Polls the health endpoint — if the stack responds with capabilities,
 * setup is complete.
 */
export async function isStackSetupComplete(): Promise<boolean> {
	try {
		const res = await fetch(`${STACK_URL}/1sat/admin/setup/status`, { signal: AbortSignal.timeout(2000) })
		if (!res.ok) return false
		const data = await res.json() as { configured?: boolean }
		return data.configured === true
	} catch {
		return false
	}
}

/**
 * Wait for the stack setup to complete (polls every 3 seconds).
 * Resolves when the stack health endpoint responds OK.
 */
export async function waitForStackSetup(timeoutMs = 300000): Promise<boolean> {
	const start = Date.now()
	while (Date.now() - start < timeoutMs) {
		if (await isStackSetupComplete()) return true
		await Bun.sleep(3000)
	}
	return false
}
