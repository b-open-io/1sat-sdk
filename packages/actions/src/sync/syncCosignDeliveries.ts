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
import { buildTokenLabel } from '@1sat/types'
import { Utils, type WalletInterface } from '@bsv/sdk'
import type { Action } from '../types'

/**
 * Unwrap the server's {message: <string>} envelope, detect the nested
 * {encryptedMessage: <base64>} ciphertext, and decrypt with the wallet
 * using the same BRC-2 ECDH/AES-256-GCM keys the sender used.
 *
 * Falls through to a plain JSON parse when neither layer is present.
 */
async function unwrapAndDecryptMessageBody(
	rawBody: unknown,
	sender: string,
	wallet: WalletInterface,
): Promise<Record<string, unknown>> {
	const tryParse = (s: string): unknown => {
		try {
			return JSON.parse(s)
		} catch {
			return s
		}
	}
	let level: unknown = rawBody
	if (typeof level === 'string') level = tryParse(level)
	// Server wraps as {message: <inner string>}.
	if (
		level !== null &&
		typeof level === 'object' &&
		typeof (level as { message?: unknown }).message === 'string'
	) {
		level = tryParse((level as { message: string }).message)
	}
	// If we now have {encryptedMessage: <base64>}, decrypt.
	if (
		level !== null &&
		typeof level === 'object' &&
		typeof (level as { encryptedMessage?: unknown }).encryptedMessage ===
			'string'
	) {
		const ciphertext = Utils.toArray(
			(level as { encryptedMessage: string }).encryptedMessage,
			'base64',
		)
		const decrypted = await wallet.decrypt({
			protocolID: [1, 'messagebox'],
			keyID: '1',
			counterparty: sender,
			ciphertext,
		})
		const plaintext = Utils.toUTF8(decrypted.plaintext)
		level = tryParse(plaintext)
	}
	if (level === null || typeof level !== 'object') {
		throw new Error('message body did not resolve to a JSON object')
	}
	return level as Record<string, unknown>
}

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
		requiresServices: true,
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
				// The server stores message bodies wrapped as {message: <inner>}
				// where <inner> is itself a JSON string of {encryptedMessage:
				// "<base64>"} (BRC-2 ECDH/AES-256-GCM ciphertext). MessageBox
				// Client.listMessages's auto-decrypt only matches when the top-
				// level parsed body has `encryptedMessage` directly, so it
				// silently skips this nested envelope. Unwrap + decrypt here.
				const body = await unwrapAndDecryptMessageBody(
					msg.body,
					msg.sender,
					ctx.wallet,
				)
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
				const tags = [
					`bsv21:${tokenId}`,
					`amt:${amount}`,
					`tokenId:${tokenId}`,
				]
				// Pull token metadata from the BSV21 overlay so the wallet's
				// balance/listing UIs can render symbol, icon, and decimals.
				// Bsv21Client caches per-tokenId, so subsequent messages for
				// the same token are free.
				if (ctx.services) {
					try {
						const details = await ctx.services.bsv21.getTokenDetails(tokenId)
						if (details.token.sym) tags.push(`sym:${details.token.sym}`)
						if (details.token.icon) tags.push(`icon:${details.token.icon}`)
						if (details.token.dec) tags.push(`dec:${details.token.dec}`)
					} catch (err) {
						console.warn(
							`[syncCosignDeliveries] token-details lookup failed for ${tokenIdShort}:`,
							err instanceof Error ? err.message : String(err),
						)
					}
				}
				await ctx.wallet.internalizeAction({
					tx: beefBytes,
					outputs: [
						{
							outputIndex: vout,
							protocol: 'basket insertion',
							insertionRemittance: {
								basket: 'bsv21',
								tags,
								customInstructions,
							},
						},
					],
					description: `Cosign token delivery (${tokenIdShort}…)`.slice(0, 50),
					labels: [buildTokenLabel(tokenId)],
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
