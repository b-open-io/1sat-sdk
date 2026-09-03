/**
 * Node runtime smoke test: the published CLI entry loads under Node, and
 * the SQLite storage provider round-trips on node:sqlite. Run after
 * `bun run build` (needs dist/ in cli, wallet-node, wallet, wallet-server).
 */
import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const cli = resolve(here, '../dist/cli.js')

if (typeof Bun !== 'undefined') {
	console.error('node-smoke must run under Node, not Bun')
	process.exit(1)
}

// 1. CLI entry loads and prints help under Node.
const help = spawnSync(process.execPath, [cli, 'help'], { encoding: 'utf8' })
if (help.status !== 0 || !/1sat/i.test(help.stdout + help.stderr)) {
	console.error('cli help failed under node:', help.status, help.stderr)
	process.exit(1)
}
console.log('ok  cli help under node')

// 2. SQLite storage on node:sqlite.
const { StorageBunSqlite } = await import('@1sat/wallet-node')
const { StorageProvider } = await import(
	'@bsv/wallet-toolbox/out/src/storage/StorageProvider.js'
)
const storage = new StorageBunSqlite({
	...StorageProvider.createStorageBaseOptions('main'),
	filename: ':memory:',
})
await storage.migrate('node-smoke', '02'.padEnd(66, 'a'))
await storage.makeAvailable()
const settings = await storage.readSettings()
if (settings.chain !== 'main') {
	console.error('unexpected settings', settings)
	process.exit(1)
}
await storage.destroy()
console.log('ok  sqlite storage on node:sqlite')
