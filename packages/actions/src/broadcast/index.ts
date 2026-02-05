/**
 * Broadcast Module
 *
 * Actions for broadcasting transactions.
 */

import { Beef, type InternalizeOutput, Transaction } from '@bsv/sdk'
import type { Action } from '../types'

// ============================================================================
// Types
// ============================================================================

export interface BroadcastRequest {
	/** Raw transaction hex */
	rawtx: string
	/** Transaction format */
	format?: 'tx' | 'beef' | 'ef'
	/** Description for wallet records */
	description?: string
}

export interface BroadcastResponse {
	txid?: string
	error?: string
}

// ============================================================================
// Actions
// ============================================================================

/**
 * Broadcast a transaction and internalize it into the wallet.
 */
export const broadcast: Action<BroadcastRequest, BroadcastResponse> = {
	meta: {
		name: 'broadcast',
		description: 'Broadcast a transaction and internalize it into the wallet',
		category: 'broadcast',
		inputSchema: {
			type: 'object',
			properties: {
				rawtx: { type: 'string', description: 'Raw transaction hex' },
				format: {
					type: 'string',
					description: 'Transaction format (tx, beef, ef)',
					enum: ['tx', 'beef', 'ef'],
				},
				description: {
					type: 'string',
					description: 'Description for wallet records',
				},
			},
			required: ['rawtx'],
		},
	},
	async execute(ctx, input) {
		try {
			let tx: Transaction
			switch (input.format) {
				case 'beef':
					tx = Transaction.fromHexBEEF(input.rawtx)
					break
				case 'ef':
					tx = Transaction.fromHexEF(input.rawtx)
					break
				default:
					tx = Transaction.fromHex(input.rawtx)
			}

			const txid = tx.id('hex')
			const beef = new Beef()
			beef.mergeTransaction(tx)

			const outputs: InternalizeOutput[] = tx.outputs.map((_, index) => ({
				outputIndex: index,
				protocol: 'wallet payment' as const,
				paymentRemittance: {
					derivationPrefix: 'default',
					derivationSuffix: `${txid}.${index}`,
					senderIdentityKey: '',
				},
			}))

			await ctx.wallet.internalizeAction({
				tx: Array.from(beef.toBinary()),
				outputs,
				description: input.description || 'Broadcast transaction',
			})

			return { txid }
		} catch (error) {
			console.error('[broadcast]', error)
			return {
				error: error instanceof Error ? error.message : 'unknown-error',
			}
		}
	},
}

// ============================================================================
// Module exports
// ============================================================================

/** All broadcast actions for registry */
export const broadcastActions = [broadcast]
