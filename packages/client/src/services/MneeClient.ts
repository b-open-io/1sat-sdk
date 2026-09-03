/**
 * MneeClient - Thin wrapper around MNEE proxy API endpoints.
 *
 * Uses the MNEE REST API directly rather than depending on @mnee/ts-sdk,
 * keeping the 1Sat SDK dependency-light. Covers balance, UTXOs, config,
 * transfer submission, and transaction status.
 *
 * Auth: query param `auth_token=<key>` on all requests.
 * Base URL: https://proxy-api.mnee.net
 */

import { Transaction, Utils } from '@bsv/sdk'
import { BaseClient } from './BaseClient.js'

// ============================================================================
// Types
// ============================================================================

export interface MneeConfig {
	approver: string
	feeAddress: string
	burnAddress: string
	mintAddress: string
	fees: MneeFeeTier[]
	decimals: number
	tokenId: string
}

export interface MneeFeeTier {
	min: number
	max: number
	fee: number
}

export interface MneeBalance {
	address: string
	/** Balance in atomic units */
	amt: number
	/** Balance in MNEE (decimal) */
	precised: number
}

export interface MneeUtxo {
	txid: string
	vout: number
	outpoint: string
	satoshis: number
	script: string
	owners: string[]
	senders: string[]
	height: number
	idx: number
	score: number
	data: {
		bsv21?: {
			id: string
			op: string
			amt: number
			sym: string
			icon: string
			dec: number
		}
		cosign?: {
			address: string
			cosigner: string
		}
	}
}

export interface MneeTransferResponse {
	ticketId?: string
	rawtx?: string
}

export interface MneeTransferStatus {
	id: string
	tx_id: string
	tx_hex: string
	action_requested: string
	status: 'BROADCASTING' | 'SUCCESS' | 'MINED' | 'FAILED'
	createdAt: string
	updatedAt: string
	errors: string | null
}

export interface MneeSyncEntry {
	txid: string
	height: number
	idx: number
	score: number
	blocktime: number
	rawtx: string
	outs: number[] | null
	senders: string[]
	receivers: string[]
}

// ============================================================================
// Constants
// ============================================================================

const MNEE_PROD_API_URL = 'https://proxy-api.mnee.net'
const MNEE_SANDBOX_API_URL = 'https://sandbox-proxy-api.mnee.net'
const MNEE_PROD_API_TOKEN = '92982ec1c0975f31979da515d46bae9f'
const MNEE_SANDBOX_API_TOKEN = '54f1fd1688ba66a58a67675b82feb93e'
const MNEE_DECIMALS = 5
const MNEE_ATOMIC_MULTIPLIER = 10 ** MNEE_DECIMALS // 100,000

// ============================================================================
// Client
// ============================================================================

export class MneeClient extends BaseClient {
	private authToken: string

	constructor(options?: {
		environment?: 'production' | 'sandbox'
		apiKey?: string
	}) {
		const env = options?.environment ?? 'production'
		const baseUrl =
			env === 'production' ? MNEE_PROD_API_URL : MNEE_SANDBOX_API_URL
		super(baseUrl, { timeout: 30000 })
		this.authToken =
			options?.apiKey ??
			(env === 'production' ? MNEE_PROD_API_TOKEN : MNEE_SANDBOX_API_TOKEN)
	}

	/** Append auth_token to a path */
	private auth(path: string): string {
		const sep = path.includes('?') ? '&' : '?'
		return `${path}${sep}auth_token=${this.authToken}`
	}

	// ===== Config =====

	async getConfig(): Promise<MneeConfig> {
		return this.request<MneeConfig>(this.auth('/v1/config'))
	}

	// ===== Balance =====

	async getBalance(address: string): Promise<MneeBalance> {
		const balances = await this.request<MneeBalance[]>(
			this.auth('/v2/balance'),
			{
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify([address]),
			},
		)
		return balances[0] ?? { address, amt: 0, precised: 0 }
	}

	async getBalances(addresses: string[]): Promise<MneeBalance[]> {
		return this.request<MneeBalance[]>(this.auth('/v2/balance'), {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(addresses),
		})
	}

	// ===== UTXOs =====

	async getUtxos(
		addresses: string | string[],
		page?: number,
		size?: number,
		order?: 'asc' | 'desc',
	): Promise<MneeUtxo[]> {
		const addrArray = Array.isArray(addresses) ? addresses : [addresses]
		let path = '/v2/utxos'
		const params: string[] = []
		if (page !== undefined) params.push(`page=${page}`)
		if (size !== undefined) params.push(`size=${size}`)
		if (order) params.push(`order=${order}`)
		if (params.length) path += `?${params.join('&')}`

		const utxos = await this.request<MneeUtxo[]>(this.auth(path), {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(addrArray),
		})
		// Filter to valid transfer/mint ops
		const ops = ['transfer', 'deploy+mint']
		return utxos.filter(
			(u) => u.data.bsv21?.op && ops.includes(u.data.bsv21.op),
		)
	}

	async getAllUtxos(addresses: string[]): Promise<MneeUtxo[]> {
		const allUtxos: MneeUtxo[] = []
		let page = 1
		const size = 1000
		let hasMore = true

		while (hasMore) {
			const batch = await this.getUtxos(addresses, page, size)
			allUtxos.push(...batch)
			hasMore = batch.length === size
			page++
		}
		return allUtxos
	}

	async getEnoughUtxos(
		addresses: string[],
		atomicAmount: number,
	): Promise<MneeUtxo[]> {
		const utxos: MneeUtxo[] = []
		let page = 1
		const size = 100
		let total = 0

		while (total < atomicAmount) {
			const batch = await this.getUtxos(addresses, page, size, 'desc')
			if (batch.length === 0) break
			for (const utxo of batch) {
				utxos.push(utxo)
				total += utxo.data.bsv21?.amt ?? 0
				if (total >= atomicAmount) break
			}
			page++
		}
		return utxos
	}

	// ===== Transfer =====

	async submitRawTx(
		rawTxHex: string,
		options?: { broadcast?: boolean; callbackUrl?: string },
	): Promise<MneeTransferResponse> {
		const broadcast = options?.broadcast ?? true
		if (!broadcast) {
			return { rawtx: rawTxHex }
		}

		// V2 API expects base64-encoded raw tx
		const txBinary = Transaction.fromHex(rawTxHex).toBinary()
		const base64Tx = Utils.toBase64(txBinary)

		const body: Record<string, unknown> = { rawtx: base64Tx }
		if (options?.callbackUrl) body.callback_url = options.callbackUrl

		// Response is plain text ticketId, not JSON
		const controller = new AbortController()
		const timeoutId = setTimeout(() => controller.abort(), this.timeout)
		try {
			const response = await this.fetchFn(
				`${this.baseUrl}${this.auth('/v2/transfer')}`,
				{
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify(body),
					signal: controller.signal,
				},
			)
			if (!response.ok) {
				throw new Error(`Failed to submit transaction: ${response.status}`)
			}
			const ticketId = await response.text()
			return { ticketId }
		} finally {
			clearTimeout(timeoutId)
		}
	}

	async getTxStatus(ticketId: string): Promise<MneeTransferStatus> {
		return this.request<MneeTransferStatus>(
			this.auth(`/v2/ticket?ticketID=${ticketId}`),
		)
	}

	// ===== Raw Transaction =====

	/** Fetch a raw transaction by txid. Returns hex string. API returns base64. */
	async fetchRawTx(txid: string): Promise<string | undefined> {
		try {
			const result = await this.request<{ rawtx?: string }>(
				this.auth(`/v1/tx/${txid}`),
			)
			if (!result.rawtx) return undefined
			// API returns base64, convert to hex
			return Utils.toHex(Utils.toArray(result.rawtx, 'base64'))
		} catch {
			return undefined
		}
	}

	// ===== History =====

	async getTxHistory(
		addresses: string | string[],
		fromScore?: number,
		limit = 50,
	): Promise<MneeSyncEntry[]> {
		const addrArray = Array.isArray(addresses) ? addresses : [addresses]
		let path = '/v1/sync'
		const params: string[] = []
		if (fromScore !== undefined) params.push(`from=${fromScore}`)
		if (limit) params.push(`limit=${limit}`)
		if (params.length) path += `?${params.join('&')}`

		return this.request<MneeSyncEntry[]>(this.auth(path), {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(addrArray),
		})
	}

	// ===== Validation =====

	async validateTx(rawTxHex: string): Promise<boolean> {
		try {
			const result = await this.request<{ valid: boolean }>(
				this.auth('/v2/transfer'),
				{
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						rawtx: rawTxHex,
						broadcast: false,
					}),
				},
			)
			return !!result
		} catch {
			return false
		}
	}

	// ===== Unit Helpers =====

	static toAtomicAmount(mneeAmount: number): number {
		return Math.round(mneeAmount * MNEE_ATOMIC_MULTIPLIER)
	}

	static fromAtomicAmount(atomicAmount: number): number {
		return atomicAmount / MNEE_ATOMIC_MULTIPLIER
	}
}
