/**
 * Message Box Sync Action
 *
 * Polls the message box for incoming paymail payments, internalizes each
 * one directly as a BRC-29 wallet payment (straight into the spendable
 * balance — no deposit basket or sweep), and acknowledges only after
 * successful internalization.
 */

import { MessageBoxClient } from '@bsv/message-box-client'
import { Beef, Utils } from '@bsv/sdk'
import type { Action } from '../types'

// ============================================================================
// Types
// ============================================================================

export interface SyncMessagesInput {
	/** Message box name to poll (default: "payment_inbox") */
	messageBox?: string
	/** MessageBox server URL (default: "https://messagebox.1sat.app") */
	messageboxUrl?: string
}

export interface SyncMessagesResult {
	/** Number of messages successfully internalized */
	processed: number
	/** Number of messages that failed to internalize */
	failed: number
}

/** Shape of the PaymailMessage body stored in the message box */
interface PaymailMessage {
	beef: string
	outputIndex: number
	derivationPrefix: string
	derivationSuffix: string
	senderIdentityKey: string
	satoshis: number
	alias: string
}

// ============================================================================
// Action
// ============================================================================

export const syncMessages: Action<SyncMessagesInput, SyncMessagesResult> = {
	meta: {
		name: 'syncMessages',
		description:
			'Sync incoming paymail payments from the message box into the wallet',
		category: 'sync',
		inputSchema: {
			type: 'object',
			properties: {
				messageBox: {
					type: 'string',
					description: 'Message box name to poll (default: "payment_inbox")',
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
		const messageBox = input.messageBox || 'payment_inbox'
		const messageboxUrl =
			input.messageboxUrl?.replace(/\/+$/, '') || 'https://messagebox.1sat.app'

		// The client unwraps the server's {message, payment} envelope and
		// decrypts encrypted bodies; plaintext bodies come back parsed.
		const client = new MessageBoxClient({
			walletClient: ctx.wallet,
			host: messageboxUrl,
		})

		const messages = await client.listMessages({
			messageBox,
			host: messageboxUrl,
		})

		if (messages.length === 0) {
			return { processed: 0, failed: 0 }
		}

		// 2. Process each message
		let processed = 0
		let failed = 0
		const acknowledgedIds: string[] = []

		for (const msg of messages) {
			try {
				const payment: PaymailMessage =
					typeof msg.body === 'string' ? JSON.parse(msg.body) : msg.body

				// The transport carries plain BEEF; internalizeAction requires
				// Atomic BEEF (BRC-95) with the subject txid.
				const beef = Beef.fromBinary(Utils.toArray(payment.beef, 'hex'))
				const txids = beef.txs
					.filter((btx) => btx.tx != null)
					.map((btx) => btx.tx!.id('hex'))
				const subjectTxid = txids[txids.length - 1]

				// Paymail destinations are standard BRC-29 sends: internalize
				// as a wallet payment so funds land directly in the spendable
				// balance. The wallet derives the key from the remittance
				// fields (senderIdentityKey is the server's anyone deriver).
				await ctx.wallet.internalizeAction({
					tx: beef.toBinaryAtomic(subjectTxid),
					outputs: [
						{
							outputIndex: payment.outputIndex,
							protocol: 'wallet payment',
							paymentRemittance: {
								derivationPrefix: payment.derivationPrefix,
								derivationSuffix: payment.derivationSuffix,
								senderIdentityKey: payment.senderIdentityKey,
							},
						},
					],
					description: `Paymail payment to ${payment.alias}`.slice(0, 50),
				})

				acknowledgedIds.push(msg.messageId)
				processed++
			} catch (error) {
				console.error(
					`[syncMessages] Failed to process message ${msg.messageId}:`,
					error instanceof Error ? error.message : String(error),
				)
				failed++
			}
		}

		// 3. Acknowledge successfully internalized messages
		if (acknowledgedIds.length > 0) {
			try {
				await client.acknowledgeMessage({
					messageIds: acknowledgedIds,
					host: messageboxUrl,
				})
			} catch (error) {
				console.error(
					'[syncMessages] Failed to acknowledge messages:',
					error instanceof Error ? error.message : String(error),
				)
			}
		}

		return { processed, failed }
	},
}
