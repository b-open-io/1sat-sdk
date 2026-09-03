/**
 * Parse --beef from file path, hex, or base64.
 */
import { readFileSync } from 'node:fs'
import { Utils } from '@bsv/sdk'
import { fatal } from './output.js'

export function parseBeefFlag(value: string | undefined): number[] | undefined {
	if (!value) return undefined
	try {
		if (!value.includes('\n') && !value.includes(' ') && value.length < 4096) {
			try {
				const buf = readFileSync(value)
				return Array.from(buf)
			} catch {
				// not a readable path — treat as hex/base64
			}
		}
		const hex = value.replace(/^0x/i, '')
		if (/^[0-9a-fA-F]+$/.test(hex) && hex.length % 2 === 0) {
			return Utils.toArray(hex, 'hex')
		}
		return Utils.toArray(value, 'base64')
	} catch (e) {
		fatal(`Invalid --beef: ${e instanceof Error ? e.message : String(e)}`)
	}
}

/** Bare id from tags (strips id: prefix). */
export function idFromTags(tags: string[] | undefined): string | undefined {
	const t = tags?.find((x) => x.startsWith('id:'))
	return t ? t.slice(3) : undefined
}

/**
 * Parse --to as P2PKH address or identity pubkey hex.
 * Identity keys: 66 hex chars starting with 02/03.
 */
export function parseToFlag(to: string): {
	address?: string
	counterparty?: string
} {
	const trimmed = to.trim()
	if (/^0[23][0-9a-fA-F]{64}$/.test(trimmed)) {
		return { counterparty: trimmed }
	}
	return { address: trimmed }
}
