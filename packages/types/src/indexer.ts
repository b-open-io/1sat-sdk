import type { Transaction, TransactionOutput } from '@bsv/sdk'

export interface Outpoint {
	txid: string
	vout: number
	toOrdinalString(): string
	toBEBinary(): number[]
}

/**
 * IndexData contains the parsed data and tags from an indexer
 * Tags are concatenated strings in the format "key:value" for searchability
 */
export interface IndexData {
	data: unknown
	tags: string[]
	/** Optional text content (e.g., from text inscriptions). */
	content?: string
}

/**
 * IndexSummary contains transaction-level summary information
 */
export interface IndexSummary {
	id?: string
	amount?: number
	icon?: string
	data?: unknown
}

/**
 * Internalization protocol for synced outputs.
 * - "wallet payment": P2PKH-based outputs that can be auto-signed
 * - "basket insertion": Custom script outputs requiring manual unlock scripts
 */
export type InternalizeProtocol = 'wallet payment' | 'basket insertion'

/**
 * Result from Indexer.parse() method
 */
export interface ParseResult {
	data: unknown
	tags: string[]
	owner?: string
	basket?: string
	/** Optional text content (e.g., from text inscriptions). Truncated to 1000 chars when stored. */
	content?: string
	/**
	 * Internalization protocol for this output.
	 * - "wallet payment": P2PKH outputs that can be auto-signed (default)
	 * - "basket insertion": Custom script outputs requiring manual unlock
	 */
	protocol?: InternalizeProtocol
}

/**
 * Transaction output structure used during parsing
 */
export interface Txo {
	output: TransactionOutput
	outpoint: Outpoint
	owner?: string
	basket?: string
	/**
	 * Internalization protocol for this output.
	 * Set by the first indexer to claim ownership.
	 * Defaults to "wallet payment" if not set.
	 */
	protocol?: InternalizeProtocol
	data: { [tag: string]: IndexData }
}

/**
 * Minimal context structure for indexer parsing
 */
export interface ParseContext {
	tx: Transaction
	txid: string
	txos: Txo[]
	spends: Txo[]
	summary: { [tag: string]: IndexSummary }
	indexers: Indexer[]
}

/**
 * Base indexer class that all indexers extend
 */
export abstract class Indexer {
	abstract tag: string
	abstract name: string

	constructor(
		public owners = new Set<string>(),
		public network: 'mainnet' | 'testnet' = 'mainnet',
	) {}

	/**
	 * Parses a single output in isolation and returns the parse result if relevant.
	 * Cannot access other outputs or inputs - only the single Txo.
	 * Cross-output/cross-input logic belongs in summarize().
	 */
	abstract parse(txo: Txo): Promise<ParseResult | undefined>

	/**
	 * Post-parse phase with full transaction context.
	 * Used for cross-output/cross-input validation and transaction-level summarization.
	 */
	async summarize(
		_ctx: ParseContext,
		_isBroadcasted: boolean,
	): Promise<IndexSummary | undefined> {
		return undefined
	}
}
