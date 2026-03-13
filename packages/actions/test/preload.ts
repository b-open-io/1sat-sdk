import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const dir = dirname(fileURLToPath(import.meta.url))
const envPath = resolve(dir, '.env')

try {
	const lines = readFileSync(envPath, 'utf-8').split('\n')
	for (const line of lines) {
		const trimmed = line.trim()
		if (!trimmed || trimmed.startsWith('#')) continue
		const eq = trimmed.indexOf('=')
		if (eq === -1) continue
		const key = trimmed.slice(0, eq)
		const value = trimmed.slice(eq + 1)
		if (!process.env[key]) process.env[key] = value
	}
} catch {
	// .env file is optional
}
