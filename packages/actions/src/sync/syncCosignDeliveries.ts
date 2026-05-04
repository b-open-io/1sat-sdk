/**
 * Cosign Token Deliveries Sync Action
 *
 * One-shot pull from a MessageBox slot used by cosign-wrapped BSV21 mints
 * and transfers. Each message body carries a finalized BEEF, the cosign
 * customInstructions the recipient will need to sign at spend time, and
 * the output index that's owned by this wallet. We internalize the output
 * into the bsv21 basket with the supplied customInstructions verbatim
 * (no derivation re-write — these are cosign-protocol keys, not BRC-29).
 *
 * Intended call sites: any UI mount where a fresh sync is desired (e.g.
 * yours-wallet popup mount). Not a polling loop.
 */

import { Utils } from '@bsv/sdk'
import { AuthFetch } from '@bsv/sdk/auth'
import type { Action } from '../types'

// ============================================================================
// Types
// ============================================================================

export interface SyncCosignDeliveriesInput {
	/** Message box name (default: "cosign_token_inbox") */
	messageBox?: string
	/** MessageBox server URL (default: "https://messagebox.1sat.app") */
	messageboxUrl?: string
}

export interface SyncCosignDeliveriesResult {
	/** Number of messages successfully internalized */
	processed: number
	/** Number of messages that failed to internalize */
	failed: number
}

/** Shape of the cosign-delivery body in each message. */
interface CosignDeliveryMessage {
	tokenId: string
	txid: string
	vout: number
	amount: string
	beef: number[] | string
	customInstructions: string
	deliveredAt?: string
}

interface MessageOut {
	messageId: string
	body: string
	sender: string
	createdAt: string
	updatedAt: string
}

interface ListMessagesResponse {
	status: string
	messages: MessageOut[]
}

// ============================================================================
// Action
// ============================================================================

export const syncCosignDeliveries: Action<
	SyncCosignDeliveriesInput,
	SyncCosignDeliveriesResult
> = {
	meta: {
		name: 'syncCosignDeliveries',
		description:
			'Pull cosign-wrapped BSV21 deliveries from a MessageBox and internalize them into the wallet',
		category: 'sync',
		inputSchema: {
			type: 'object',
			properties: {
				messageBox: {
					type: 'string',
					description:
						'Message box name to pull from (default: "cosign_token_inbox")',
				},
				messageboxUrl: {
					type: 'string',
					description:
						'MessageBox server URL (default: "https://messagebox.1sat.app")',
				},
			},
		},
		requiresServices: false,
	},

	async execute(ctx, input) {
		const messageBox = input.messageBox || 'cosign_token_inbox'
		const messageboxUrl =
			input.messageboxUrl?.replace(/\/+$/, '') ||
			'https://messagebox.1sat.app'

		const authFetch = new AuthFetch(ctx.wallet)

		// 1. List pending messages.
		const listResponse = await authFetch.fetch(
			`${messageboxUrl}/listMessages`,
			{
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ messageBox }),
			},
		)
		if (!listResponse.ok) {
			throw new Error(
				`Failed to list messages: ${listResponse.status} ${listResponse.statusText}`,
			)
		}
		const { messages } = (await listResponse.json()) as ListMessagesResponse
		if (!messages || messages.length === 0) {
			return { processed: 0, failed: 0 }
		}

		// 2. Internalize each delivery into the wallet's bsv21 basket.
		let processed = 0
		let failed = 0
		const acknowledgedIds: string[] = []
		for (const msg of messages) {
			try {
				const delivery = JSON.parse(msg.body) as CosignDeliveryMessage
				const beefBytes = Array.isArray(delivery.beef)
					? delivery.beef
					: Utils.toArray(delivery.beef, 'hex')
				const tags = [
					`bsv21:${delivery.tokenId}`,
					`amt:${delivery.amount}`,
					`tokenId:${delivery.tokenId}`,
				]
				await ctx.wallet.internalizeAction({
					tx: beefBytes,
					outputs: [
						{
							outputIndex: delivery.vout,
							protocol: 'basket insertion',
							insertionRemittance: {
								basket: 'bsv21',
								tags,
								customInstructions: delivery.customInstructions,
							},
						},
					],
					description: `Cosign token delivery (${delivery.tokenId.slice(0, 8)}…)`.slice(
						0,
						50,
					),
					labels: [`bsv21:${delivery.tokenId}`],
				})
				acknowledgedIds.push(msg.messageId)
				processed++
			} catch (error) {
				console.error(
					`[syncCosignDeliveries] Failed to process message ${msg.messageId}:`,
					error instanceof Error ? error.message : String(error),
				)
				failed++
			}
		}

		// 3. Acknowledge successfully internalized messages.
		if (acknowledgedIds.length > 0) {
			const ackResponse = await authFetch.fetch(
				`${messageboxUrl}/acknowledgeMessage`,
				{
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ messageIds: acknowledgedIds }),
				},
			)
			if (!ackResponse.ok) {
				console.error(
					`[syncCosignDeliveries] Failed to acknowledge messages: ${ackResponse.status}`,
				)
			}
		}

		return { processed, failed }
	},
}
