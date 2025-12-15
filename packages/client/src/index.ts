/**
 * @1sat/client - API client for 1Sat Ordinals SDK
 *
 * This package provides:
 * - HTTP client abstraction (browser/Node.js compatible)
 * - UTXO fetching (payment, NFT, token)
 * - Token selection utilities
 * - Transaction broadcasting
 * - Input conversion utilities
 */

// HTTP client
export {
	createHttpClient,
	FetchHttpClient,
	type FetchFn,
	type FetchOptions,
	type HttpClient,
	type HttpClientRequestOptions,
	type HttpClientResponse,
} from './http'

// Indexer (UTXO fetching)
export {
	fetchNftUtxos,
	fetchPayUtxos,
	fetchTokenUtxos,
	selectTokenUtxos,
	type FetchNftOptions,
	type FetchOptions as IndexerFetchOptions,
	type FetchTokenOptions,
	type ScriptEncoding,
} from './indexer'

// Broadcasting
export {
	createBroadcaster,
	OneSatBroadcaster,
	type BroadcasterConfig,
} from './broadcast'

// Input utilities
export {
	inputFromUtxo,
	inputsFromUtxos,
	type UnlockTemplate,
} from './input'
