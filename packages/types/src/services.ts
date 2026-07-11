/**
 * Consolidated type definitions for 1sat-stack API clients.
 * These types mirror the structures returned by the 1sat-stack server.
 */

// ============================================================================
// Client Configuration
// ============================================================================

/**
 * Options for configuring API clients
 */
export interface ClientOptions {
	/** Request timeout in milliseconds (default: 30000) */
	timeout?: number
	/** Custom fetch implementation */
	fetch?: typeof fetch
}

// ============================================================================
// Server Capabilities
// ============================================================================

/**
 * Server capabilities returned by /1sat/capabilities endpoint.
 * These match the actual capability names from 1sat-stack.
 */
export type Capability =
	| 'admin' // Admin panel (/1sat/admin)
	| 'bap' // BAP identity (/1sat/bap)
	| 'beef' // BEEF storage, raw tx, proofs (/1sat/beef)
	| 'pubsub' // SSE subscriptions (/1sat/sse)
	| 'txo' // TXO lookup (/1sat/txo)
	| 'owner' // Owner queries (/1sat/owner)
	| 'bsv21' // BSV21 tokens (/1sat/bsv21)
	| 'bsocial' // BSocial data (/1sat/bsocial)
	| 'opns' // OpNS names (/1sat/opns)
	| 'market' // OrdLock listings (/1sat/market)
	| 'paymail' // Paymail resolution (/1sat/bsvalias)
	| 'sweep' // Sweep UI (/1sat/sweep)
	| 'ordfs' // Content serving (/1sat/ordfs)
	| 'chaintracks' // Block headers (/1sat/chaintracks)
	| 'arcade' // TX broadcast (/1sat/tx)
	| 'overlay' // Overlay engine (per-module /1sat/<svc>/overlay)

// ============================================================================
// Chaintracks Types (Block Headers)
// ============================================================================

/**
 * Block header data returned by chaintracks endpoints
 */
export interface BlockHeader {
	height: number
	hash: string
	version: number
	prevHash: string
	merkleRoot: string
	time: number
	bits: number
	nonce: number
}

// ============================================================================
// Arcade Types (Transaction Broadcast)
// ============================================================================

/**
 * Transaction status values from arcade
 */
export type TxStatus =
	| 'UNKNOWN'
	| 'RECEIVED'
	| 'SENT_TO_NETWORK'
	| 'ACCEPTED_BY_NETWORK'
	| 'SEEN_ON_NETWORK'
	| 'DOUBLE_SPEND_ATTEMPTED'
	| 'REJECTED'
	| 'MINED'
	| 'IMMUTABLE'

/**
 * Transaction status response from arcade
 */
export interface TransactionStatus {
	txid: string
	txStatus: TxStatus
	timestamp: string
	blockHash?: string
	blockHeight?: number
	merklePath?: string
	extraInfo?: string
	competingTxs?: string[]
}

/**
 * Options for submitting transactions to arcade
 */
export interface SubmitOptions {
	/** URL for status callbacks */
	callbackUrl?: string
	/** Token for authenticating callbacks */
	callbackToken?: string
	/** Receive all status updates, not just final */
	fullStatusUpdates?: boolean
	/** Skip fee validation */
	skipFeeValidation?: boolean
	/** Skip script validation */
	skipScriptValidation?: boolean
}

// ============================================================================
// TXO Types (Transaction Outputs)
// ============================================================================

/**
 * Indexed transaction output.
 * Base fields (outpoint, score) are always present.
 * Other fields are present based on query options.
 */
export interface IndexedOutput {
	outpoint: string
	score: number
	satoshis?: number
	blockHeight?: number
	blockIdx?: number
	spend?: string
	events?: string[]
	data?: Record<string, unknown>
}

/**
 * Spend information response
 */
export interface SpendResponse {
	spendTxid: string | null
}

/**
 * Options for querying TXOs
 */
export interface TxoQueryOptions {
	/** Starting score for pagination */
	from?: number
	/** Maximum results to return */
	limit?: number
	/** Reverse order */
	rev?: boolean
	/** Filter for unspent only */
	unspent?: boolean
	/** Include satoshis in response */
	sats?: boolean
	/** Include spend txid in response */
	spend?: boolean
	/** Include events array in response */
	events?: boolean
	/** Include blockHeight and blockIdx in response */
	block?: boolean
	/** Data tags to include in response */
	tags?: string[]
}

// ============================================================================
// Owner Types (Address Queries)
// ============================================================================

/**
 * Balance response from owner endpoint
 */
export interface BalanceResponse {
	balance: number
	count: number
}

/**
 * Sync output streamed via SSE
 */
export interface SyncOutput {
	outpoint: string
	score: number
	spendTxid?: string
}

/**
 * Progress update streamed during owner sync via SSE.
 * Phases: "fetch" → "ingest" → "done" (or "error").
 */
export interface SyncProgress {
	/** Current sync phase */
	phase: 'fetch' | 'ingest' | 'done' | 'error'
	/** Total transactions to process (set after fetch) */
	total?: number
	/** Transactions processed so far */
	processed?: number
	/** Error message when phase is "error" */
	error?: string
	/** Owner being synced */
	owner?: string
	/** Last synced block height */
	height?: number
}

// ============================================================================
// Indexer Types
// ============================================================================

/**
 * Indexed output from parse/ingest operations
 */
export interface IndexedTxo {
	outpoint: string
	satoshis: number
	script?: string
	owners?: string[]
	events?: string[]
	data?: Record<string, unknown>
}

/**
 * Index context returned by parse/ingest
 */
export interface IndexContext {
	txid: string
	score: number
	outputs: IndexedTxo[]
}

// ============================================================================
// ORDFS Types (Content)
// ============================================================================

/**
 * OrdFS metadata for an inscription
 */
export interface OrdfsMetadata {
	outpoint: string
	origin?: string
	sequence: number
	contentType: string
	contentLength: number
	parent?: string
	map?: Record<string, unknown>
}

/**
 * Options for OrdFS content requests
 */
export interface OrdfsContentOptions {
	/** Sequence number (-1 for latest, 0+ for specific sequence) */
	seq?: number
	/** Include MAP data in X-Map header */
	map?: boolean
	/** Include parent outpoint in X-Parent header */
	parent?: boolean
	/** Return raw directory JSON instead of resolving */
	raw?: boolean
}

/**
 * Headers returned from OrdFS content responses
 */
export interface OrdfsResponseHeaders {
	contentType: string
	outpoint?: string
	origin?: string
	sequence?: number
	cacheControl?: string
	map?: Record<string, unknown>
	parent?: string
}

/**
 * Full content response from OrdFS including headers
 */
export interface OrdfsContentResponse {
	data: Uint8Array
	headers: OrdfsResponseHeaders
}

// ============================================================================
// BSV21 Types (Tokens)
// ============================================================================

/**
 * BSV21 token data structure from overlay API
 */
export interface Bsv21TokenData {
	id: string
	op: string
	amt: string
	sym?: string
	dec?: string
	icon?: string
	address?: string
}

/**
 * BSV21 token detail response from GET /bsv21/:tokenId and POST /bsv21/lookup
 */
export interface TokenDetailResponse {
	tokenId: string
	token: Bsv21TokenData
	status: TokenStatus
}

/**
 * BSV21 token funding/activity status
 */
export interface TokenStatus {
	token_id: string
	is_active: boolean
	balance: number
	credits: number
	debits: number
	output_count: number
	fee_per_output: number
	fee_address: string
	is_whitelisted: boolean
	is_blacklisted: boolean
}

/**
 * BSV21 output data from overlay API
 */
export interface Bsv21OutputData {
	txid?: string
	vout: number
	data: {
		bsv21: Bsv21TokenData
	}
	spend?: string | null
	score?: number
}

/**
 * BSV21 transaction data from overlay API
 */
export interface Bsv21TransactionData {
	txid: string
	inputs: Bsv21OutputData[]
	outputs: Bsv21OutputData[]
	beef?: string
	block_height?: number
}

// ============================================================================
// BAP Types (Identity)
// ============================================================================

/**
 * Address entry in a BAP identity's address history
 */
export interface BapAddress {
	address: string
	txId: string
	block: number
}

/**
 * BAP identity as returned by /1sat/bap/identity/get
 *
 * Note: the `identity` field contains the on-chain profile data (schema.org).
 * This naming comes from the BAP protocol's storage format.
 */
export interface BapIdentity {
	idKey: string
	firstSeen: number
	rootAddress: string
	currentAddress: string
	addresses: BapAddress[]
	identity?: Record<string, unknown>
}

/**
 * Validity record returned as part of validByAddress response
 */
export interface BapValidityRecord {
	valid: boolean
	block: number
}

/**
 * Response from POST /1sat/bap/identity/validByAddress
 */
export interface BapValidByAddressResponse {
	identity: BapIdentity
	validityRecord: BapValidityRecord
	profile?: Record<string, unknown>
}

/**
 * Profile list entry from GET /1sat/bap/profile
 */
export interface BapProfileEntry {
	_id: string
	data: unknown
}

// ============================================================================
// SSE/PubSub Types
// ============================================================================

/**
 * Event from SSE subscription
 */
export interface SseEvent {
	topic: string
	data: string
	score?: number
}
