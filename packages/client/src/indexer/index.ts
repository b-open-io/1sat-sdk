/**
 * 1Sat Indexer API client
 *
 * Provides methods for fetching UTXOs from the 1Sat API
 */

import { API_HOST } from '@1sat/constants'
import type {
	NftUtxo,
	TokenSelectionOptions,
	TokenSelectionResult,
	TokenUtxo,
	Utxo,
} from '@1sat/types'
import { TokenSelectionStrategy, TokenType } from '@1sat/types'
import { P2PKH, Script, Utils } from '@bsv/sdk'
import { toToken } from 'satoshi-token'

const { toBase64, toHex, fromBase58Check, toArray } = Utils

export type ScriptEncoding = 'hex' | 'base64' | 'asm'

export interface FetchOptions {
	/** API host URL (defaults to mainnet) */
	apiHost?: string
	/** Script encoding format */
	scriptEncoding?: ScriptEncoding
}

export interface FetchNftOptions extends FetchOptions {
	/** Filter by collection ID */
	collectionId?: string
	/** Number of UTXOs to fetch */
	limit?: number
	/** Offset for pagination */
	offset?: number
}

export interface FetchTokenOptions extends FetchOptions {
	/** Number of UTXOs to fetch */
	limit?: number
	/** Offset for pagination */
	offset?: number
}

/**
 * Check if a UTXO has a lock (time-locked output)
 */
function isLocked(utxo: Utxo): boolean {
	const data = (utxo as unknown as { data?: { lock?: unknown } }).data
	return !!data?.lock
}

/**
 * Convert script bytes to specified encoding
 */
function encodeScript(scriptBytes: number[], encoding: ScriptEncoding): string {
	switch (encoding) {
		case 'hex':
			return toHex(scriptBytes)
		case 'base64':
			return toBase64(scriptBytes)
		case 'asm':
			return Script.fromBinary(scriptBytes).toASM()
	}
}

/**
 * Fetch payment UTXOs for an address
 *
 * @param address - Address to fetch UTXOs for
 * @param options - Fetch options
 * @returns Array of payment UTXOs (excludes 1-sat and locked outputs)
 */
export async function fetchPayUtxos(
	address: string,
	options: FetchOptions = {},
): Promise<Utxo[]> {
	const { apiHost = API_HOST, scriptEncoding = 'base64' } = options

	const url = `${apiHost}/txos/address/${address}/unspent?bsv20=false`
	const res = await fetch(url)

	if (!res.ok) {
		throw new Error(`Error fetching pay UTXOs: ${res.statusText}`)
	}

	const rawUtxos = (await res.json()) as Utxo[]

	// Filter out 1-sat outputs and locked outputs
	const filtered = rawUtxos.filter((u) => u.satoshis !== 1 && !isLocked(u))

	// Get pubkey hash from address and create P2PKH script
	const { data: pubKeyHash } = fromBase58Check(address)
	const p2pkhScript = new P2PKH().lock(pubKeyHash as number[])
	const scriptBytes = p2pkhScript.toBinary()

	return filtered.map((utxo) => ({
		txid: utxo.txid,
		vout: utxo.vout,
		satoshis: utxo.satoshis,
		script: encodeScript(scriptBytes, scriptEncoding),
	}))
}

/**
 * Fetch NFT UTXOs for an address
 *
 * @param address - Address to fetch UTXOs for
 * @param options - Fetch options including optional collection filter
 * @returns Array of NFT UTXOs
 */
export async function fetchNftUtxos(
	address: string,
	options: FetchNftOptions = {},
): Promise<NftUtxo[]> {
	const {
		apiHost = API_HOST,
		scriptEncoding = 'base64',
		collectionId,
		limit = 10,
		offset = 0,
	} = options

	let url = `${apiHost}/txos/address/${address}/unspent?limit=${limit}&offset=${offset}&`

	// Add collection filter if specified
	if (collectionId) {
		const query = { map: { subTypeData: { collectionId } } }
		const queryJson = JSON.stringify(query)
		const queryBytes = toArray(queryJson, 'utf8')
		url += `q=${toBase64(queryBytes)}`
	}

	const res = await fetch(url)
	if (!res.ok) {
		throw new Error(`Error fetching NFT UTXOs: ${res.statusText}`)
	}

	const rawUtxos = (await res.json()) as Array<{
		txid: string
		vout: number
		satoshis: number
		data?: { list?: { price: number; payout: string } }
	}>

	// Filter to 1-sat non-listed outputs
	const filtered = rawUtxos.filter((u) => u.satoshis === 1 && !u.data?.list)

	if (filtered.length === 0) {
		return []
	}

	// Fetch scripts for these outpoints
	const outpoints = filtered.map((u) => `${u.txid}_${u.vout}`)
	const scriptRes = await fetch(`${apiHost}/txos/outpoints?script=true`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(outpoints),
	})

	if (!scriptRes.ok) {
		throw new Error(`Error fetching NFT scripts: ${scriptRes.statusText}`)
	}

	const nftsWithScripts = (await scriptRes.json()) as Array<{
		txid: string
		vout: number
		script: string
		origin: { outpoint: string }
	}>

	return nftsWithScripts.map((utxo) => {
		// Script from API is base64, convert if needed
		const scriptBytes = toArray(utxo.script, 'base64')
		const script = encodeScript(scriptBytes, scriptEncoding)

		const nftUtxo: NftUtxo = {
			txid: utxo.txid,
			vout: utxo.vout,
			satoshis: 1,
			script,
			origin: utxo.origin.outpoint,
			contentType: '', // Would need additional API call for content type
		}

		if (collectionId) {
			nftUtxo.collectionId = collectionId
		}

		return nftUtxo
	})
}

/**
 * Fetch token UTXOs for an address
 *
 * @param protocol - Token protocol (BSV20 or BSV21)
 * @param tokenId - Token ID (tick for BSV20, origin for BSV21)
 * @param address - Address to fetch UTXOs for
 * @param options - Fetch options
 * @returns Array of token UTXOs
 */
export async function fetchTokenUtxos(
	protocol: TokenType,
	tokenId: string,
	address: string,
	options: FetchTokenOptions = {},
): Promise<TokenUtxo[]> {
	const { apiHost = API_HOST, limit = 10, offset = 0 } = options

	const idParam = protocol === TokenType.BSV20 ? 'tick' : 'id'
	const url = `${apiHost}/bsv20/${address}/${idParam}/${tokenId}?bsv20=true&listing=false&limit=${limit}&offset=${offset}`

	const res = await fetch(url)
	if (!res.ok) {
		throw new Error(`Error fetching ${protocol} UTXOs: ${res.statusText}`)
	}

	const rawUtxos = (await res.json()) as Array<{
		txid: string
		vout: number
		script: string
		amt: string
	}>

	return rawUtxos.map((utxo) => ({
		txid: utxo.txid,
		vout: utxo.vout,
		satoshis: 1,
		script: utxo.script,
		amt: utxo.amt,
		id: tokenId,
	}))
}

/**
 * Select token UTXOs to satisfy a required amount
 *
 * @param tokenUtxos - Available token UTXOs
 * @param requiredTokens - Required amount in display format
 * @param decimals - Token decimal places
 * @param options - Selection strategy options
 * @returns Selected UTXOs and total selected amount
 */
export function selectTokenUtxos(
	tokenUtxos: TokenUtxo[],
	requiredTokens: number,
	decimals: number,
	options: TokenSelectionOptions = {},
): TokenSelectionResult {
	const {
		inputStrategy = TokenSelectionStrategy.RetainOrder,
		outputStrategy = TokenSelectionStrategy.RetainOrder,
	} = options

	// Sort UTXOs based on input strategy
	const sortedUtxos = [...tokenUtxos].sort((a, b) => {
		if (inputStrategy === TokenSelectionStrategy.RetainOrder) return 0

		const amtA = BigInt(a.amt)
		const amtB = BigInt(b.amt)

		switch (inputStrategy) {
			case TokenSelectionStrategy.SmallestFirst:
				return Number(amtA - amtB)
			case TokenSelectionStrategy.LargestFirst:
				return Number(amtB - amtA)
			case TokenSelectionStrategy.Random:
				return Math.random() - 0.5
			default:
				return 0
		}
	})

	let totalSelected = 0
	const selectedUtxos: TokenUtxo[] = []

	for (const utxo of sortedUtxos) {
		selectedUtxos.push(utxo)
		totalSelected += toToken(utxo.amt, decimals)
		if (totalSelected >= requiredTokens && requiredTokens > 0) {
			break
		}
	}

	// Sort selected UTXOs based on output strategy
	if (outputStrategy !== TokenSelectionStrategy.RetainOrder) {
		selectedUtxos.sort((a, b) => {
			const amtA = BigInt(a.amt)
			const amtB = BigInt(b.amt)

			switch (outputStrategy) {
				case TokenSelectionStrategy.SmallestFirst:
					return Number(amtA - amtB)
				case TokenSelectionStrategy.LargestFirst:
					return Number(amtB - amtA)
				case TokenSelectionStrategy.Random:
					return Math.random() - 0.5
				default:
					return 0
			}
		})
	}

	return {
		selectedUtxos,
		totalSelected,
		isEnough: totalSelected >= requiredTokens,
	}
}
