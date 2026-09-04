import { Hash, Utils } from '@bsv/sdk'

function assertValidUnicode(value: string): void {
	for (let index = 0; index < value.length; index += 1) {
		const codeUnit = value.charCodeAt(index)
		if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
			if (index + 1 >= value.length) {
				throw new Error('settlement-canonical-json: invalid Unicode')
			}
			const next = value.charCodeAt(index + 1)
			if (next < 0xdc00 || next > 0xdfff) {
				throw new Error('settlement-canonical-json: invalid Unicode')
			}
			index += 1
		} else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
			throw new Error('settlement-canonical-json: invalid Unicode')
		}
	}
}

function quoteString(value: string): string {
	assertValidUnicode(value)
	return JSON.stringify(value)
}

function canonicalizeValue(value: unknown): string {
	if (value === null) return 'null'
	if (typeof value === 'string') {
		return quoteString(value)
	}
	if (typeof value === 'boolean') {
		return JSON.stringify(value)
	}
	if (typeof value === 'number') {
		if (!Number.isFinite(value)) {
			throw new Error('settlement-canonical-json: numbers must be finite')
		}
		return JSON.stringify(value)
	}
	if (Array.isArray(value)) {
		return `[${value.map((item) => canonicalizeValue(item)).join(',')}]`
	}
	if (typeof value === 'object') {
		const object = value as Record<string, unknown>
		const entries = Object.keys(object)
			.filter((key) => object[key] !== undefined)
			.sort()
			.map((key) => {
				assertValidUnicode(key)
				const child = object[key]
				return `${quoteString(key)}:${canonicalizeValue(child)}`
			})
		return `{${entries.join(',')}}`
	}
	throw new Error(`settlement-canonical-json: unsupported ${typeof value}`)
}

/** RFC 8785 JSON Canonicalization Scheme for settlement wire objects. */
export function canonicalizeSettlementJson(value: unknown): string {
	return canonicalizeValue(value)
}

/** SHA-256(UTF8(JCS(value))), lowercase hexadecimal. */
export function digestSettlementObject(value: unknown): string {
	return Utils.toHex(
		Hash.sha256(Utils.toArray(canonicalizeSettlementJson(value), 'utf8')),
	)
}

export function hashSettlementBytes(value: number[] | Uint8Array): string {
	return Utils.toHex(Hash.sha256(Array.from(value)))
}

export function assertExactKeys(
	value: Record<string, unknown>,
	required: readonly string[],
	optional: readonly string[] = [],
	context = 'object',
): void {
	const allowed = new Set([...required, ...optional])
	for (const key of Object.keys(value)) {
		if (!allowed.has(key)) {
			throw new Error(`${context}: unknown field ${key}`)
		}
	}
	for (const key of required) {
		if (!(key in value)) throw new Error(`${context}: missing field ${key}`)
	}
}
