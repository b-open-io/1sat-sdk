/**
 * Message Box Sync Action
 *
 * Polls the message box for incoming paymail payments,
 * internalizes each one via the shared BEEF pipeline,
 * and acknowledges only after successful internalization.
 */

import { Utils } from '@bsv/sdk'
import { AuthFetch } from '@bsv/sdk/auth'
import type { Action } from '../types'
import {
	internalizeBeef,
	type OutputDerivation,
} from '../utils/internalizeBeef'

// ============================================================================
// Types
// ============================================================================

export interface SyncMessagesInput {
	/** Message box name to poll (default: "payment_inbox") */
	messageBox?: string
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

/** Shape of a single message from the listMessages response */
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
					description:
						'Message box name to poll (default: "payment_inbox")',
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
		const messageboxUrl = `${services.baseUrl}/1sat/messagebox`

		const authFetch = new AuthFetch(ctx.wallet)

		// 1. List pending messages
		const listResponse = await authFetch.fetch(`${messageboxUrl}/listMessages`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ messageBox }),
		})

		if (!listResponse.ok) {
			throw new Error(
				`Failed to list messages: ${listResponse.status} ${listResponse.statusText}`,
			)
		}

		const { messages } = (await listResponse.json()) as ListMessagesResponse

		if (!messages || messages.length === 0) {
			return { processed: 0, failed: 0 }
		}

		// 2. Process each message
		let processed = 0
		let failed = 0
		const acknowledgedIds: string[] = []

		for (const msg of messages) {
			try {
				const payment: PaymailMessage = JSON.parse(msg.body)

				const beefBytes = new Uint8Array(Utils.toArray(payment.beef, 'hex'))

				const outputDerivation: OutputDerivation = {
					outputIndex: payment.outputIndex,
					derivationPrefix: payment.derivationPrefix,
					derivationSuffix: payment.derivationSuffix,
					senderIdentityKey: payment.senderIdentityKey,
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
					`[syncMessages] Failed to acknowledge messages: ${ackResponse.status}`,
				)
			}
		}

		return { processed, failed }
	},
}
