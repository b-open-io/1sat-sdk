/**
 * MNEE Module
 *
 * Actions for querying and transferring MNEE stablecoin.
 * Uses the MNEE API for balance/UTXO queries and transaction submission.
 * Addresses are derived from the wallet's BRC-29 "yours" prefix (indices 0-4).
 */

import type {
	MneeBalance,
	MneeUtxo,
	MneeTransferResponse,
	MneeTransferStatus,
	MneeTxHistoryResponse,
	MneeConfig,
	MneeClient,
} from '@1sat/client'
import type { Action, OneSatContext } from '../types'
import { deriveDepositAddresses } from '../addresses'

// ============================================================================
// Helpers
// ============================================================================

const YOURS_PREFIX = 'yours'
const YOURS_ADDRESS_COUNT = 5

/** Derive all 5 yours wallet addresses for MNEE operations */
async function deriveYoursAddresses(ctx: OneSatContext): Promise<string[]> {
	const result = await deriveDepositAddresses.execute(ctx, {
		prefix: YOURS_PREFIX,
		startIndex: 0,
		count: YOURS_ADDRESS_COUNT,
	})
	return result.derivations.map((d) => d.address)
}

function getMneeClient(ctx: OneSatContext): MneeClient {
	if (!ctx.services?.mnee) {
		throw new Error('MNEE client not available — services required')
	}
	return ctx.services.mnee
}

// ============================================================================
// Types
// ============================================================================

export interface GetMneeBalanceInput {
	/** Specific addresses to query. If omitted, derives all yours wallet addresses. */
	addresses?: string[]
}

export interface GetMneeBalanceResult {
	/** Per-address balances */
	balances: MneeBalance[]
	/** Total balance in MNEE (decimal) */
	totalDecimal: number
	/** Total balance in atomic units */
	totalAtomic: number
}

export interface GetMneeUtxosInput {
	/** Specific addresses to query. If omitted, derives all yours wallet addresses. */
	addresses?: string[]
}

export interface GetMneeUtxosResult {
	utxos: MneeUtxo[]
}

export interface GetMneeConfigInput {
	// no params
}

export interface GetMneeHistoryInput {
	/** Specific address. If omitted, uses primary address (index 0). */
	address?: string
	/** Pagination cursor */
	fromScore?: number
	/** Max results (default 50) */
	limit?: number
}

export interface SendMneeInput {
	/** Recipients */
	recipients: Array<{ address: string; amount: number }>
	/** Specific source addresses. If omitted, derives all yours wallet addresses. */
	fromAddresses?: string[]
}

export interface SendMneeResult {
	ticketId?: string
	rawtx?: string
	error?: string
}

export interface GetMneeTxStatusInput {
	ticketId: string
}

// ============================================================================
// Actions
// ============================================================================

/**
 * Get MNEE balance across all yours wallet addresses.
 */
export const getMneeBalance: Action<GetMneeBalanceInput, GetMneeBalanceResult> = {
	meta: {
		name: 'getMneeBalance',
		description: 'Get MNEE stablecoin balance across yours wallet addresses',
		category: 'payments',
		requiresServices: true,
		inputSchema: {
			type: 'object',
			properties: {
				addresses: {
					type: 'array',
					description: 'Specific addresses to query (omit to use yours wallet addresses)',
				},
			},
		},
	},
	async execute(ctx, input) {
		const mnee = getMneeClient(ctx)
		const addresses = input.addresses ?? await deriveYoursAddresses(ctx)
		const balances = await mnee.getBalances(addresses)

		const totalAtomic = balances.reduce((sum, b) => sum + b.amount, 0)
		const totalDecimal = balances.reduce((sum, b) => sum + b.decimalAmount, 0)

		return { balances, totalDecimal, totalAtomic }
	},
}

/**
 * Get MNEE UTXOs across all yours wallet addresses.
 */
export const getMneeUtxos: Action<GetMneeUtxosInput, GetMneeUtxosResult> = {
	meta: {
		name: 'getMneeUtxos',
		description: 'Get MNEE UTXOs across yours wallet addresses',
		category: 'payments',
		requiresServices: true,
		inputSchema: {
			type: 'object',
			properties: {
				addresses: {
					type: 'array',
					description: 'Specific addresses to query (omit to use yours wallet addresses)',
				},
			},
		},
	},
	async execute(ctx, input) {
		const mnee = getMneeClient(ctx)
		const addresses = input.addresses ?? await deriveYoursAddresses(ctx)
		const utxos = await mnee.getAllUtxos(addresses)
		return { utxos }
	},
}

/**
 * Get MNEE service configuration (cosigner, fees, etc).
 */
export const getMneeConfig: Action<GetMneeConfigInput, MneeConfig> = {
	meta: {
		name: 'getMneeConfig',
		description: 'Get MNEE service configuration including cosigner and fee structure',
		category: 'payments',
		requiresServices: true,
		inputSchema: {
			type: 'object',
			properties: {},
		},
	},
	async execute(ctx) {
		const mnee = getMneeClient(ctx)
		return mnee.getConfig()
	},
}

/**
 * Get MNEE transaction history for an address.
 */
export const getMneeHistory: Action<GetMneeHistoryInput, MneeTxHistoryResponse> = {
	meta: {
		name: 'getMneeHistory',
		description: 'Get MNEE transaction history',
		category: 'payments',
		requiresServices: true,
		inputSchema: {
			type: 'object',
			properties: {
				address: {
					type: 'string',
					description: 'Address to query (omit for primary address)',
				},
				fromScore: {
					type: 'number',
					description: 'Pagination cursor',
				},
				limit: {
					type: 'number',
					description: 'Max results (default 50)',
				},
			},
		},
	},
	async execute(ctx, input) {
		const mnee = getMneeClient(ctx)
		const address = input.address ?? (await deriveYoursAddresses(ctx))[0]
		return mnee.getTxHistory(address, input.fromScore, input.limit)
	},
}

/**
 * Get the status of an MNEE transfer by ticket ID.
 */
export const getMneeTxStatus: Action<GetMneeTxStatusInput, MneeTransferStatus> = {
	meta: {
		name: 'getMneeTxStatus',
		description: 'Get the status of an MNEE transfer',
		category: 'payments',
		requiresServices: true,
		inputSchema: {
			type: 'object',
			properties: {
				ticketId: {
					type: 'string',
					description: 'Ticket ID from a transfer response',
				},
			},
			required: ['ticketId'],
		},
	},
	async execute(ctx, input) {
		const mnee = getMneeClient(ctx)
		return mnee.getTxStatus(input.ticketId)
	},
}

// ============================================================================
// Module exports
// ============================================================================

export const mneeActions = [
	getMneeBalance,
	getMneeUtxos,
	getMneeConfig,
	getMneeHistory,
	getMneeTxStatus,
]
