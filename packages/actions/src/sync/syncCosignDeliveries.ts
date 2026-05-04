/**
 * Cosign Token Deliveries Sync Action
 *
 * One-shot pull from a MessageBox slot used by cosign-wrapped BSV21 mints
 * and transfers. Each (decrypted) message body carries a finalized BEEF,
 * the cosign customInstructions the recipient will need at spend time, and
 * the output index that's owned by this wallet. We internalize the output
 * into the bsv21 basket with the supplied customInstructions verbatim.
 *
 * Uses `@bsv/p2p` MessageBoxClient so encrypted bodies are decrypted using
 * BRC-2 ECDH/AES-256-GCM via the wallet (matches what the sender used to
 * encrypt). Intended call sites: any UI mount where a fresh sync is
 * desired (e.g. yours-wallet popup mount). Not a polling loop.
 */

import { MessageBoxClient } from '@bsv/p2p'
import { Utils } from '@bsv/sdk'
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

/** Shape of the cosign-delivery body in each message (after decryption). */
interface CosignDeliveryBody {
	tokenId: string
	txid: string
	vout: number
	amount: string
	beef: number[] | string
	customInstructions: string
	deliveredAt?: string
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
		const host =
			input.messageboxUrl?.replace(/\/+$/, '') ||
			'https://messagebox.1sat.app'

		// MessageBoxClient encrypts on send and decrypts on listMessages,
		// so we go through it (not raw AuthFetch) — the bodies on the wire
		// are AES-256-GCM ciphertext under BRC-2 ECDH keys.
		// biome-ignore lint/suspicious/noExplicitAny: WalletInterface typing diff between @bsv/sdk versions
		const client = new MessageBoxClient({ walletClient: ctx.wallet as any, host })

		const messages = await client.listMessages({ messageBox, host })
		if (messages.length === 0) {
			return { processed: 0, failed: 0 }
		}

		let processed = 0
		let failed = 0
		const acknowledgedIds: string[] = []
		for (const msg of messages) {
			try {
				// MessageBoxClient.listMessages returns body as already-parsed
				// JSON object when the cleartext was JSON. Defensive: parse if
				// we still see a string.
				const body =
					typeof msg.body === 'string'
						? (JSON.parse(msg.body) as CosignDeliveryBody)
						: (msg.body as unknown as CosignDeliveryBody)
				console.log(
					`[syncCosignDeliveries] message ${msg.messageId} parsed body keys:`,
					Object.keys(body as object),
				)
				if (
					!body.tokenId ||
					body.vout === undefined ||
					!body.beef ||
					!body.customInstructions
				) {
					throw new Error(
						`message body missing required fields (have keys: ${Object.keys(body as object).join(',')})`,
					)
				}
				const beefBytes = Array.isArray(body.beef)
					? body.beef
					: Utils.toArray(body.beef, 'hex')
				const tokenIdShort = String(body.tokenId).slice(0, 8)
				const tags = [
					`bsv21:${body.tokenId}`,
					`amt:${body.amount ?? '0'}`,
					`tokenId:${body.tokenId}`,
				]
				await ctx.wallet.internalizeAction({
					tx: beefBytes,
					outputs: [
						{
							outputIndex: body.vout,
							protocol: 'basket insertion',
							insertionRemittance: {
								basket: 'bsv21',
								tags,
								customInstructions: body.customInstructions,
							},
						},
					],
					description: `Cosign token delivery (${tokenIdShort}…)`.slice(0, 50),
					labels: [`bsv21:${body.tokenId}`],
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

		if (acknowledgedIds.length > 0) {
			try {
				await client.acknowledgeMessage({ messageIds: acknowledgedIds, host })
			} catch (err) {
				console.error(
					'[syncCosignDeliveries] Failed to acknowledge messages:',
					err instanceof Error ? err.message : String(err),
				)
			}
		}

		return { processed, failed }
	},
}
