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

function canonicalizeValue(value: unknown, ancestors: Set<object>): string {
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
		if (Number.isInteger(value) && !Number.isSafeInteger(value)) {
			throw new Error('settlement-canonical-json: integers must be safe')
		}
		return JSON.stringify(value)
	}
	if (Array.isArray(value)) {
		if (ancestors.has(value)) {
			throw new Error('settlement-canonical-json: cyclic value')
		}
		const propertyNames = Object.getOwnPropertyNames(value)
		const expectedNames = [
			...Array.from({ length: value.length }, (_, index) => String(index)),
			'length',
		]
		if (
			Object.getOwnPropertySymbols(value).length > 0 ||
			propertyNames.length !== expectedNames.length ||
			expectedNames.some((name) => !propertyNames.includes(name))
		) {
			throw new Error(
				'settlement-canonical-json: arrays must contain JSON values',
			)
		}
		ancestors.add(value)
		try {
			return `[${value
				.map((item, index) => {
					const descriptor = Object.getOwnPropertyDescriptor(
						value,
						String(index),
					)
					if (!descriptor || !('value' in descriptor)) {
						throw new Error(
							'settlement-canonical-json: arrays must contain JSON values',
						)
					}
					return canonicalizeValue(item, ancestors)
				})
				.join(',')}]`
		} finally {
			ancestors.delete(value)
		}
	}
	if (typeof value === 'object') {
		const prototype = Object.getPrototypeOf(value)
		if (prototype !== Object.prototype && prototype !== null) {
			throw new Error('settlement-canonical-json: objects must be plain JSON')
		}
		if (ancestors.has(value)) {
			throw new Error('settlement-canonical-json: cyclic value')
		}
		const object = value as Record<string, unknown>
		const keys = Object.keys(object)
		if (
			Object.getOwnPropertySymbols(object).length > 0 ||
			Object.getOwnPropertyNames(object).length !== keys.length
		) {
			throw new Error(
				'settlement-canonical-json: objects must contain JSON values',
			)
		}
		ancestors.add(value)
		try {
			const entries = keys.sort().map((key) => {
				assertValidUnicode(key)
				const descriptor = Object.getOwnPropertyDescriptor(object, key)
				if (!descriptor || !('value' in descriptor)) {
					throw new Error(
						'settlement-canonical-json: objects must contain JSON values',
					)
				}
				return `${quoteString(key)}:${canonicalizeValue(
					descriptor.value,
					ancestors,
				)}`
			})
			return `{${entries.join(',')}}`
		} finally {
			ancestors.delete(value)
		}
	}
	throw new Error(`settlement-canonical-json: unsupported ${typeof value}`)
}

/** RFC 8785 JSON Canonicalization Scheme for settlement wire objects. */
export function canonicalizeSettlementJson(value: unknown): string {
	return canonicalizeValue(value, new Set())
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
		if (!Object.hasOwn(value, key)) {
			throw new Error(`${context}: missing field ${key}`)
		}
	}
	for (const key of optional) {
		if (!Object.hasOwn(value, key) && key in value) {
			throw new Error(`${context}: inherited field ${key}`)
		}
	}
}
