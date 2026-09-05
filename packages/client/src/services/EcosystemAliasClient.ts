import type { ClientOptions } from '@1sat/types'
import { Beef, Transaction, Utils } from '@bsv/sdk'
import { BaseClient } from './BaseClient.js'

export const ECOSYSTEM_ALIAS_LOOKUP_SERVICE = 'ls_ecosystemalias' as const

const LOOKUP_PATH = '/1sat/ecosystemalias/overlay/lookup'
const MAX_LIMIT = 500
const ASCII_WRAP_WHITESPACE = /^[ \t\n\r\f\v]|[ \t\n\r\f\v]$/

interface EcosystemAliasQueryOptions {
	/** Maximum number of outputs to return. The server default is 100. */
	limit?: number
	/** Number of live outputs to skip (uint32). The server default is zero. */
	skip?: number
}

/** Lookup every live claim for one normalized ecosystem alias. */
export type EcosystemAliasByAliasQuery = EcosystemAliasQueryOptions & {
	alias: string
	domain?: never
}

/** Lookup every live claim for one normalized domain. */
export type EcosystemAliasByDomainQuery = EcosystemAliasQueryOptions & {
	domain: string
	alias?: never
}

/** List every live claim. Empty object or skip/limit only. */
export type EcosystemAliasAllQuery = EcosystemAliasQueryOptions & {
	alias?: never
	domain?: never
}

/** Alias, domain, or empty dump. */
export type EcosystemAliasQuery =
	| EcosystemAliasByAliasQuery
	| EcosystemAliasByDomainQuery
	| EcosystemAliasAllQuery

/** One validated BRC-24 output-list entry. */
export interface EcosystemAliasLookupOutput {
	/** Atomic BEEF bytes exactly as returned by the lookup provider. */
	beef: Uint8Array
	outputIndex: number
	/** Transaction ID derived locally from the Atomic BEEF. */
	txid: string
	/** Optional BRC-24 output context, when supplied by the provider. */
	context?: Uint8Array
}

export interface EcosystemAliasLookupResult {
	type: 'output-list'
	/** All provider results in provider order, including conflicting claims. */
	outputs: EcosystemAliasLookupOutput[]
}

type NormalizedQuery =
	| (EcosystemAliasQueryOptions & { alias: string })
	| (EcosystemAliasQueryOptions & { domain: string })
	| EcosystemAliasQueryOptions

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function assertAllowedKeys(
	value: Record<string, unknown>,
	allowed: readonly string[],
	label: string,
): void {
	const allowedSet = new Set(allowed)
	for (const key of Object.keys(value)) {
		if (!allowedSet.has(key)) {
			throw new TypeError(`${label} contains unknown field ${key}`)
		}
	}
}

function rejectInvalidQueryText(value: unknown, label: string): string {
	if (typeof value !== 'string') {
		throw new TypeError(`${label} must be a string`)
	}
	if (value.length === 0) {
		throw new TypeError(`${label} must not be empty`)
	}
	if (ASCII_WRAP_WHITESPACE.test(value)) {
		throw new TypeError(`${label} must not have leading or trailing whitespace`)
	}
	for (let index = 0; index < value.length; index++) {
		if (value.charCodeAt(index) > 0x7f) {
			throw new TypeError(`${label} must be ASCII; Unicode must be punycode`)
		}
	}
	return value.replace(/[A-Z]/g, (character) => character.toLowerCase())
}

function normalizeAlias(value: unknown): string {
	const alias = rejectInvalidQueryText(value, 'alias')
	if (
		alias.length > 32 ||
		alias.startsWith('-') ||
		alias.endsWith('-') ||
		alias.includes('--') ||
		!/^[a-z0-9-]+$/.test(alias)
	) {
		throw new TypeError(
			'alias must be 1 to 32 ASCII letters or digits with internal single hyphens',
		)
	}
	return alias
}

function normalizeDomain(value: unknown): string {
	const domain = rejectInvalidQueryText(value, 'domain')
	const labels = domain.split('.')
	if (
		domain.length > 253 ||
		domain.endsWith('.') ||
		labels.length < 2 ||
		labels.some(
			(label) =>
				label.length < 1 ||
				label.length > 63 ||
				label.startsWith('-') ||
				label.endsWith('-') ||
				!/^[a-z0-9-]+$/.test(label),
		)
	) {
		throw new TypeError('domain must be a lowercase ASCII RFC 1123 FQDN')
	}
	return domain
}

function normalizeQuery(query: EcosystemAliasQuery): NormalizedQuery {
	if (!isRecord(query)) {
		throw new TypeError('ecosystem alias query must be an object')
	}
	assertAllowedKeys(
		query,
		['alias', 'domain', 'limit', 'skip'],
		'ecosystem alias query',
	)

	const hasAlias = query.alias !== undefined
	const hasDomain = query.domain !== undefined
	if (hasAlias && hasDomain) {
		throw new TypeError('ecosystem alias query must not combine alias and domain')
	}

	const options: EcosystemAliasQueryOptions = {}
	if (query.limit !== undefined) {
		if (
			typeof query.limit !== 'number' ||
			!Number.isInteger(query.limit) ||
			query.limit < 1 ||
			query.limit > MAX_LIMIT
		) {
			throw new TypeError('limit must be an integer from 1 to 500')
		}
		options.limit = query.limit
	}
	if (query.skip !== undefined) {
		if (
			typeof query.skip !== 'number' ||
			!Number.isInteger(query.skip) ||
			query.skip < 0 ||
			query.skip > 0xffffffff
		) {
			throw new TypeError('skip must be an integer from 0 to 4294967295')
		}
		options.skip = query.skip
	}

	if (hasAlias) {
		return { alias: normalizeAlias(query.alias), ...options }
	}
	if (hasDomain) {
		return { domain: normalizeDomain(query.domain), ...options }
	}
	return options
}

function decodeBytes(value: unknown, label: string): Uint8Array {
	if (Array.isArray(value)) {
		if (
			value.some(
				(byte) =>
					typeof byte !== 'number' ||
					!Number.isInteger(byte) ||
					byte < 0 ||
					byte > 255,
			)
		) {
			throw new TypeError(`${label} must contain only byte values`)
		}
		return new Uint8Array(value)
	}
	if (typeof value === 'string') {
		if (
			value.length === 0 ||
			!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
				value,
			)
		) {
			throw new TypeError(`${label} must be canonical base64`)
		}
		const bytes = new Uint8Array(Utils.toArray(value, 'base64'))
		if (Utils.toBase64(Array.from(bytes)) !== value) {
			throw new TypeError(`${label} must be canonical base64`)
		}
		return bytes
	}
	throw new TypeError(`${label} must be base64 or a byte array`)
}

function validateResponse(value: unknown): EcosystemAliasLookupOutput[] {
	if (!isRecord(value)) {
		throw new TypeError('ecosystem alias lookup response must be an object')
	}
	assertAllowedKeys(
		value,
		['type', 'outputs', 'result'],
		'ecosystem alias lookup response',
	)
	if (
		value.type !== 'output-list' ||
		(value.result !== undefined && value.result !== '') ||
		(value.outputs !== null && !Array.isArray(value.outputs))
	) {
		throw new TypeError(
			'ecosystem alias lookup response must be a standard output-list',
		)
	}
	const rawOutputs = value.outputs ?? []

	return rawOutputs.map((rawOutput, index) => {
		if (!isRecord(rawOutput)) {
			throw new TypeError(`outputs[${index}] must be an object`)
		}
		assertAllowedKeys(
			rawOutput,
			['beef', 'outputIndex', 'context'],
			`outputs[${index}]`,
		)
		const beef = decodeBytes(rawOutput.beef, `outputs[${index}].beef`)
		if (
			typeof rawOutput.outputIndex !== 'number' ||
			!Number.isInteger(rawOutput.outputIndex) ||
			rawOutput.outputIndex < 0 ||
			rawOutput.outputIndex > 0xffffffff
		) {
			throw new TypeError(
				`outputs[${index}].outputIndex must be a uint32 integer`,
			)
		}

		let transaction: Transaction
		try {
			// The SDK's prefix parser intentionally accepts a BEEF prefix. Track the
			// shared reader position first so an otherwise-valid Atomic BEEF with any
			// trailing bytes is rejected before its subject transaction is trusted.
			const reader = new Utils.Reader(Array.from(beef))
			Beef.fromReader(reader)
			if (reader.pos !== beef.length) {
				throw new Error('Atomic BEEF contains trailing data')
			}
			transaction = Transaction.fromAtomicBEEF(beef)
		} catch {
			throw new TypeError(`outputs[${index}].beef is not valid Atomic BEEF`)
		}
		if (transaction.outputs[rawOutput.outputIndex] === undefined) {
			throw new TypeError(
				`outputs[${index}].outputIndex does not exist in its transaction`,
			)
		}

		const output: EcosystemAliasLookupOutput = {
			beef,
			outputIndex: rawOutput.outputIndex,
			txid: transaction.id('hex').toLowerCase(),
		}
		if (Object.hasOwn(rawOutput, 'context')) {
			output.context = decodeBytes(
				rawOutput.context,
				`outputs[${index}].context`,
			)
		}
		return output
	})
}

/** Client for the generic BRC-169 ecosystem-alias lookup service. */
export class EcosystemAliasClient extends BaseClient {
	constructor(baseUrl: string, options: ClientOptions = {}) {
		super(baseUrl, options)
	}

	async lookup(
		query: EcosystemAliasQuery,
	): Promise<EcosystemAliasLookupResult> {
		const normalizedQuery = normalizeQuery(query)
		const response = await this.request<unknown>(LOOKUP_PATH, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				service: ECOSYSTEM_ALIAS_LOOKUP_SERVICE,
				query: normalizedQuery,
			}),
		})
		const outputs = validateResponse(response)
		return { type: 'output-list', outputs }
	}
}
