/**
 * Message Box Sync Action
 *
 * Polls the message box for incoming paymail payments,
 * internalizes each one via the shared BEEF pipeline,
 * and acknowledges only after successful internalization.
 */

import { P1SAT_PROTOCOL } from '@1sat/types'
import { MessageBoxClient } from '@bsv/message-box-client'
import { Utils } from '@bsv/sdk'
import type { Action } from '../types'
import {
	type OutputDerivation,
	internalizeBeef,
} from '../utils/internalizeBeef'

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
		requiresServices: true,
	},

	async execute(ctx, input) {
		const services = ctx.services
		if (!services) {
			throw new Error('syncMessages requires services in context')
		}

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

				const beefBytes = new Uint8Array(Utils.toArray(payment.beef, 'hex'))

				// Paymail-style messagebox payments are BRC-29 sends from a
				// known counterparty — sender provides their identity, our
				// wallet derives the spend key under P1SAT_PROTOCOL with the
				// sender as counterparty.
				const outputDerivation: OutputDerivation = {
					outputIndex: payment.outputIndex,
					derivationPrefix: payment.derivationPrefix,
					derivationSuffix: payment.derivationSuffix,
					senderIdentityKey: payment.senderIdentityKey,
					protocolID: P1SAT_PROTOCOL,
					counterparty: payment.senderIdentityKey,
				}

				await internalizeBeef({
					beef: beefBytes,
					outputs: [outputDerivation],
					wallet: ctx.wallet,
					services,
					chain: ctx.chain,
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
