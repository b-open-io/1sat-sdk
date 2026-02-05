/**
 * Balance Module
 *
 * Actions for querying wallet balance and payment UTXOs.
 */

import {
	EXCHANGE_RATE_CACHE_TTL,
	FUNDING_BASKET,
	WOC_MAINNET_URL,
	WOC_TESTNET_URL,
} from '../constants'
import type { Action } from '../types'

// ============================================================================
// Types
// ============================================================================

export interface Balance {
	/** Balance in satoshis */
	satoshis: number
	/** Balance in BSV */
	bsv: number
	/** Balance in USD cents */
	usdInCents: number
}

export interface PaymentUtxo {
	txid: string
	vout: number
	satoshis: number
	script: string
}

// Module-level cache for exchange rate
let exchangeRateCache: { rate: number; timestamp: number } | null = null

// ============================================================================
// Internal helpers
// ============================================================================

async function fetchExchangeRate(
	chain: 'main' | 'test',
	wocApiKey?: string,
): Promise<number> {
	if (
		exchangeRateCache &&
		Date.now() - exchangeRateCache.timestamp < EXCHANGE_RATE_CACHE_TTL
	) {
		return exchangeRateCache.rate
	}

	const baseUrl = chain === 'main' ? WOC_MAINNET_URL : WOC_TESTNET_URL
	const headers: Record<string, string> = {}
	if (wocApiKey) headers['woc-api-key'] = wocApiKey

	try {
		const response = await fetch(`${baseUrl}/exchangerate`, { headers })
		if (!response.ok) throw new Error(`Failed to fetch: ${response.statusText}`)

		const data = await response.json()
		const rate = Number(data.rate.toFixed(2))
		exchangeRateCache = { rate, timestamp: Date.now() }
		return rate
	} catch {
		return exchangeRateCache?.rate ?? 0
	}
}

// ============================================================================
// Actions
// ============================================================================

/** Input for getBalance action (no required params) */
export type GetBalanceInput = Record<string, never>

/**
 * Get wallet balance with USD conversion.
 */
export const getBalance: Action<GetBalanceInput, Balance> = {
	meta: {
		name: 'getBalance',
		description: 'Get wallet balance in satoshis, BSV, and USD cents',
		category: 'balance',
		inputSchema: {
			type: 'object',
			properties: {},
		},
	},
	async execute(ctx) {
		const exchangeRate = await fetchExchangeRate(ctx.chain, ctx.wocApiKey)
		const result = await ctx.wallet.listOutputs({
			basket: FUNDING_BASKET,
			limit: 10000,
		})
		const satoshis = result.outputs.reduce((sum, o) => sum + o.satoshis, 0)
		const bsv = satoshis / 100_000_000
		const usdInCents = Math.round(bsv * exchangeRate * 100)
		return { satoshis, bsv, usdInCents }
	},
}

/** Input for getPaymentUtxos action (no required params) */
export type GetPaymentUtxosInput = Record<string, never>

/**
 * Get payment UTXOs for external use.
 */
export const getPaymentUtxos: Action<GetPaymentUtxosInput, PaymentUtxo[]> = {
	meta: {
		name: 'getPaymentUtxos',
		description: 'Get payment UTXOs from the wallet for external use',
		category: 'balance',
		inputSchema: {
			type: 'object',
			properties: {},
		},
	},
	async execute(ctx) {
		const result = await ctx.wallet.listOutputs({
			basket: FUNDING_BASKET,
			include: 'locking scripts',
			limit: 10000,
		})
		return result.outputs.map((o) => {
			const [txid, voutStr] = o.outpoint.split('.')
			return {
				txid,
				vout: Number.parseInt(voutStr, 10),
				satoshis: o.satoshis,
				script: o.lockingScript || '',
			}
		})
	},
}

/** Input for getExchangeRate action (no required params) */
export type GetExchangeRateInput = Record<string, never>

/**
 * Get current BSV/USD exchange rate.
 */
export const getExchangeRate: Action<GetExchangeRateInput, number> = {
	meta: {
		name: 'getExchangeRate',
		description: 'Get current BSV/USD exchange rate from WhatsOnChain',
		category: 'balance',
		inputSchema: {
			type: 'object',
			properties: {},
		},
	},
	async execute(ctx) {
		return fetchExchangeRate(ctx.chain, ctx.wocApiKey)
	},
}

// ============================================================================
// Module exports
// ============================================================================

/** All balance actions for registry */
export const balanceActions = [getBalance, getPaymentUtxos, getExchangeRate]
