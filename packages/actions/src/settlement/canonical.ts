import { Hash, Utils } from '@bsv/sdk'

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
}
