/**
 * Cosign Token Deliveries Sync Action
 *
 * One-shot pull from a MessageBox slot used by cosign-wrapped BSV21 mints
 * and transfers. Each (decrypted) message body carries a finalized BEEF,
 * the cosign customInstructions the recipient will need at spend time, and
 * the output index that's owned by this wallet. We internalize the output
 * into the bsv21 basket with the supplied customInstructions verbatim.
 *
 * Uses `@bsv/message-box-client` MessageBoxClient, which unwraps the
 * server's {message, payment} envelope and decrypts BRC-2 ECDH/AES-256-GCM
 * encrypted bodies via the wallet (matches what the sender used to
 * encrypt). Intended call sites: any UI mount where a fresh sync is
 * desired (e.g. yours-wallet popup mount). Not a polling loop.
 */

import { BSV21_BASKET } from '@1sat/types'
import { MessageBoxClient } from '@bsv/message-box-client'
import { Utils } from '@bsv/sdk'
import type { Action } from '../types.js'
import {
	bsv21FilterTags,
	overwriteBsv21CiFields,
} from '../utils/bsv21Remittance.js'
import { looksLikeJson } from '../utils/walletMetadataCi.js'

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
		requiresServices: true,
	},

	async execute(ctx, input) {
		const messageBox = input.messageBox || 'cosign_token_inbox'
		const host =
			input.messageboxUrl?.replace(/\/+$/, '') || 'https://messagebox.1sat.app'

		// MessageBoxClient encrypts on send and decrypts on listMessages,
		// so we go through it (not raw AuthFetch) — the bodies on the wire
		// are AES-256-GCM ciphertext under BRC-2 ECDH keys.
		const client = new MessageBoxClient({ walletClient: ctx.wallet, host })

		const messages = await client.listMessages({ messageBox, host })
		if (messages.length === 0) {
			return { processed: 0, failed: 0 }
		}

		let processed = 0
		let failed = 0
		const acknowledgedIds: string[] = []
		for (const msg of messages) {
			try {
				const rawBody: unknown =
					typeof msg.body === 'string' ? JSON.parse(msg.body) : msg.body
				if (rawBody === null || typeof rawBody !== 'object') {
					throw new Error('message body did not resolve to a JSON object')
				}
				const body = rawBody as Record<string, unknown>
				console.log(
					`[syncCosignDeliveries] message ${msg.messageId} parsed body keys:`,
					Object.keys(body as object),
				)
				const tokenId = typeof body.tokenId === 'string' ? body.tokenId : ''
				const vout = typeof body.vout === 'number' ? body.vout : -1
				const beefField = body.beef
				const customInstructions =
					typeof body.customInstructions === 'string'
						? body.customInstructions
						: ''
				const amount =
					typeof body.amount === 'string' || typeof body.amount === 'number'
						? String(body.amount)
						: '0'
				if (!tokenId || vout < 0 || !beefField || !customInstructions) {
					throw new Error(
						`message body missing required fields (have keys: ${Object.keys(body).join(',')})`,
					)
				}
				const beefBytes = Array.isArray(beefField)
					? (beefField as number[])
					: typeof beefField === 'string'
						? Utils.toArray(beefField, 'hex')
						: []
				if (beefBytes.length === 0) {
					throw new Error('beef field could not be decoded as bytes')
				}
				const tokenIdShort = tokenId.slice(0, 8)
				// Filter tags only. Load-bearing meta → CI (keep cosign derivation).
				const tags = bsv21FilterTags({ tokenId })
				let ciOut = customInstructions
				if (looksLikeJson(customInstructions)) {
					let sym: string | undefined
					let dec: string | number | undefined
					let icon: string | undefined
					if (ctx.services) {
						try {
							const details = await ctx.services.bsv21.getTokenDetails(tokenId)
							sym = details.token.sym
							dec = details.token.dec
							icon = details.token.icon
						} catch (err) {
							console.warn(
								`[syncCosignDeliveries] token-details lookup failed for ${tokenIdShort}:`,
								err instanceof Error ? err.message : String(err),
							)
						}
					}
					ciOut = overwriteBsv21CiFields(customInstructions, {
						id: tokenId,
						amt: amount,
						op: 'transfer',
						...(sym && { sym }),
						...(dec !== undefined && { dec }),
						...(icon && { icon }),
					})
				}
				// No p-labels on internalize (WPM double-encrypt footgun).
				await ctx.wallet.internalizeAction({
					tx: beefBytes,
					outputs: [
						{
							outputIndex: vout,
							protocol: 'basket insertion',
							insertionRemittance: {
								basket: BSV21_BASKET,
								tags,
								customInstructions: ciOut,
							},
						},
					],
					description: `Cosign token delivery (${tokenIdShort}…)`.slice(0, 50),
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
