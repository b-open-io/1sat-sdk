/**
 * Sweep Module Types
 */

import type { IndexedOutput } from '@1sat/types'
import type { PrivateKey } from '@bsv/sdk'

/** Page size for ordinal / OpNS / listing batches in CLI, sweep-ui, and Yours. */
export const SWEEP_BATCH_SIZE = 25

/** Input for sweep operations - a UTXO to be swept */
export interface SweepInput {
	/** Outpoint in format "txid_vout" */
	outpoint: string
	/** Satoshis in this output */
	satoshis: number
	/** Locking script hex */
	lockingScript: string
}

/** Request to sweep BSV funds */
export interface SweepBsvRequest {
	/** UTXOs to spend from source wallet */
	inputs: SweepInput[]
	/** Private keys for signing, parallel to inputs */
	keys: PrivateKey[]
	/** Amount to sweep (in satoshis). If omitted, sweeps all input value. */
	amount?: number
}

/** Response from sweep operation */
export interface SweepBsvResponse {
	/** Transaction ID if successful */
	txid?: string
	/** BEEF (transaction with validity proof) */
	beef?: number[]
	/** Error message if failed */
	error?: string
}

/** Request to sweep ordinals */
export interface SweepOrdinalsRequest {
	/** Ordinal UTXOs to sweep */
	inputs: SweepInput[]
	/** Private keys for signing, parallel to inputs */
	keys: PrivateKey[]
}

/** Response from ordinal sweep operation */
export interface SweepOrdinalsResponse {
	/** Transaction ID if successful */
	txid?: string
	/** BEEF (transaction with validity proof) */
	beef?: number[]
	/** Error message if failed */
	error?: string
}

/** Input for BSV-21 token sweep */
export interface SweepBsv21Input extends SweepInput {
	/** Token ID (txid_vout format) */
	tokenId: string
	/** Token amount as string (bigint serialization) */
	amount: string
}

/** Request to sweep BSV-21 tokens */
export interface SweepBsv21Request {
	/** Token UTXOs to sweep (must all be same tokenId) */
	inputs: SweepBsv21Input[]
	/** Private keys for signing, parallel to inputs */
	keys: PrivateKey[]
}

/** Response from BSV-21 token sweep operation */
export interface SweepBsv21Response {
	/** Transaction ID if successful */
	txid?: string
	/** BEEF (transaction with validity proof) */
	beef?: number[]
	/** Error message if failed */
	error?: string
}

/** Input for BSV-20 token sweep */
export interface SweepBsv20Input extends SweepInput {
	/** Token ticker */
	tick: string
	/** Token amount as string (bigint serialization) */
	amount: string
}

/** Request to sweep BSV-20 tokens */
export interface SweepBsv20Request {
	/** Token UTXOs to sweep (must all be the same tick) */
	inputs: SweepBsv20Input[]
	/** Private keys for signing, parallel to inputs */
	keys: PrivateKey[]
}

/** Response from BSV-20 token sweep operation */
export interface SweepBsv20Response {
	txid?: string
	beef?: number[]
	error?: string
}

/** Result from a prepare operation -- contains unsigned tx for client-side signing */
export interface PrepareResult {
	/** BEEF hex of the unsigned transaction */
	txHex: string
	/** Opaque reference string for signAction */
	reference: string
	/** Inputs that need client-side signing */
	inputsToSign: Array<{
		/** Input index in the transaction */
		index: number
		/** Outpoint (txid_vout format) */
		outpoint: string
		/** Satoshis in the input */
		satoshis: number
		/** Locking script hex */
		lockingScript: string
	}>
}

/** Progress during address scanning */
export interface ScanProgress {
	phase: string
	detail?: string
}

/** A group of BSV-21 token outputs with overlay-validated data */
export interface TokenBalance {
	tokenId: string
	symbol?: string
	decimals: number
	icon?: string
	totalAmount: bigint
	/** Original outputs from the general indexer (have own: events for key resolution) */
	outputs: IndexedOutput[]
	/** Overlay-validated amounts: outpoint → token amount string */
	amounts: Map<string, string>
	/**
	 * Whether every scanned output was confirmed by the overlay.
	 * `unconfirmed` is advisory: the output may still be valid while the
	 * overlay is inactive, unfunded, or behind the chain.
	 */
	validationStatus?: 'confirmed' | 'unconfirmed'
	isActive: boolean
}

/** A group of BSV-20 token outputs keyed by ticker */
export interface Bsv20Balance {
	tick: string
	decimals: number
	totalAmount: bigint
	outputs: IndexedOutput[]
	/** outpoint → token amount string */
	amounts: Map<string, string>
}

/** Categorized UTXOs from scanning an address */
export interface ScanResult {
	funding: IndexedOutput[]
	ordinals: IndexedOutput[]
	opnsNames: IndexedOutput[]
	bsv21Tokens: TokenBalance[]
	bsv20Tokens: IndexedOutput[]
	locked: IndexedOutput[]
	run: IndexedOutput[]
	/** OrdLock marketplace listings (cancel into BRC-100 on sweep / load). */
	listings: IndexedOutput[]
	totalFundingSats: number
}
