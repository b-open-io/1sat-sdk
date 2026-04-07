/**
 * MneeClient - Thin wrapper around MNEE API endpoints.
 *
 * Uses the MNEE REST API directly rather than depending on @mnee/ts-sdk,
 * keeping the 1Sat SDK dependency-light. Covers balance, UTXOs, config,
 * transfer submission, and transaction status.
 */

import { BaseClient } from './BaseClient'

// ============================================================================
// Types
// ============================================================================

export interface MneeConfig {
	approver: string
	feeAddress: string
	burnAddress: string
	mintAddress: string
	fees: MneeFeeTier[]
}

export interface MneeFeeTier {
	min: number
	max: number
	fee: number
}

export interface MneeBalance {
	address: string
	amount: number
	decimalAmount: number
}

export interface MneeUtxo {
	txid: string
	vout: number
	outpoint: string
	satoshis: number
	accSats: number
	script: string
	owners: string[]
	data: {
		types: string[]
		bsv21?: {
			id: string
			p: string
			op: string
			amt: number
			sym: string
			icon: string
			dec: number
		}
		[key: string]: unknown
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

export interface MneeTxHistory {
	txid: string
	height: number
	status: 'confirmed' | 'unconfirmed'
	type: 'send' | 'receive'
	amount: number
	counterparties: Array<{ address: string; amount: number }>
	fee: number
	score: number
}

export interface MneeTxHistoryResponse {
	address: string
	history: MneeTxHistory[]
	nextScore: number
}

// ============================================================================
// Constants
// ============================================================================

const MNEE_API_URL = 'https://api.mnee.net'
const MNEE_DECIMALS = 5
const MNEE_ATOMIC_MULTIPLIER = 10 ** MNEE_DECIMALS // 100,000

// ============================================================================
// Client
// ============================================================================

export class MneeClient extends BaseClient {
	private apiKey?: string

	constructor(apiKey?: string) {
		super(MNEE_API_URL, { timeout: 30000 })
		this.apiKey = apiKey
	}

	private authHeaders(): HeadersInit {
		const headers: Record<string, string> = {
			'Content-Type': 'application/json',
		}
		if (this.apiKey) headers['x-api-key'] = this.apiKey
		return headers
	}

	// ===== Config =====

	async getConfig(): Promise<MneeConfig> {
		return this.request<MneeConfig>('/config', {
			headers: this.authHeaders(),
		})
	}

	// ===== Balance =====

	async getBalance(address: string): Promise<MneeBalance> {
		return this.request<MneeBalance>(`/balance/${address}`, {
			headers: this.authHeaders(),
		})
	}

	async getBalances(addresses: string[]): Promise<MneeBalance[]> {
		return this.request<MneeBalance[]>('/balances', {
			method: 'POST',
			headers: this.authHeaders(),
			body: JSON.stringify(addresses),
		})
	}

	// ===== UTXOs =====

	async getUtxos(
		address: string | string[],
		page = 0,
		size = 100,
		order: 'asc' | 'desc' = 'desc',
	): Promise<MneeUtxo[]> {
		if (Array.isArray(address)) {
			return this.request<MneeUtxo[]>(
				`/utxos?page=${page}&size=${size}&order=${order}`,
				{
					method: 'POST',
					headers: this.authHeaders(),
					body: JSON.stringify(address),
				},
			)
		}
		return this.request<MneeUtxo[]>(
			`/utxos/${address}?page=${page}&size=${size}&order=${order}`,
			{ headers: this.authHeaders() },
		)
	}

	async getAllUtxos(addresses: string[]): Promise<MneeUtxo[]> {
		const allUtxos: MneeUtxo[] = []
		let page = 0
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
		address: string,
		atomicAmount: number,
	): Promise<MneeUtxo[]> {
		const utxos: MneeUtxo[] = []
		let page = 0
		const size = 100
		let total = 0

		while (total < atomicAmount) {
			const batch = await this.getUtxos(address, page, size, 'desc')
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
		return this.request<MneeTransferResponse>('/submit', {
			method: 'POST',
			headers: this.authHeaders(),
			body: JSON.stringify({
				rawtx: rawTxHex,
				broadcast: options?.broadcast ?? true,
				callbackUrl: options?.callbackUrl,
			}),
		})
	}

	async getTxStatus(ticketId: string): Promise<MneeTransferStatus> {
		return this.request<MneeTransferStatus>(`/status/${ticketId}`, {
			headers: this.authHeaders(),
		})
	}

	// ===== History =====

	async getTxHistory(
		address: string,
		fromScore?: number,
		limit = 50,
	): Promise<MneeTxHistoryResponse> {
		const params = new URLSearchParams({ limit: String(limit) })
		if (fromScore !== undefined) params.set('fromScore', String(fromScore))
		return this.request<MneeTxHistoryResponse>(
			`/history/${address}?${params}`,
			{ headers: this.authHeaders() },
		)
	}

	// ===== Validation =====

	async validateTx(rawTxHex: string): Promise<boolean> {
		const result = await this.request<{ valid: boolean }>('/validate', {
			method: 'POST',
			headers: this.authHeaders(),
			body: JSON.stringify({ rawtx: rawTxHex }),
		})
		return result.valid
	}

	// ===== Unit Helpers =====

	static toAtomicAmount(mneeAmount: number): number {
		return Math.round(mneeAmount * MNEE_ATOMIC_MULTIPLIER)
	}

	static fromAtomicAmount(atomicAmount: number): number {
		return atomicAmount / MNEE_ATOMIC_MULTIPLIER
	}
}
