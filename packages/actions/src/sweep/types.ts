/**
 * Sweep Module Types
 */

import type { PrivateKey } from '@bsv/sdk'
import type { IndexedOutput } from '@1sat/types'

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

/** Input for BSV-21 token sweep — only the fields the action reads */
export interface SweepBsv21Input {
	/** Outpoint in format "txid_vout" */
	outpoint: string
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
	isActive: boolean
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
	totalFundingSats: number
}
