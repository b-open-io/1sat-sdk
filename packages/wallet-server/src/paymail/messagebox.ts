/**
 * Authenticated send to messagebox — port of Go MessageBoxClient.
 */

import { AuthFetch, CompletedProtoWallet, PrivateKey, type WalletInterface } from '@bsv/sdk'
import type { PendingPayment } from './types'

export interface PaymailMessageBody {
	beef: string
	outputIndex: number
	derivationPrefix: string
	derivationSuffix: string
	senderIdentityKey: string
	satoshis: number
	alias: string
}

/** BRC-29 anyone root identity (matches Go AnyoneDeriverIdentityKey). */
export function anyoneIdentityKeyHex(): string {
	return new PrivateKey(1).toPublicKey().toString()
}

export class MessageBoxClient {
	private authFetch: AuthFetch
	private baseUrl: string

	constructor(baseUrl: string, wallet: WalletInterface) {
		this.baseUrl = baseUrl.replace(/\/$/, '')
		this.authFetch = new AuthFetch(wallet)
	}

	static fromPrivateKey(baseUrl: string, privateKey: PrivateKey): MessageBoxClient {
		return new MessageBoxClient(baseUrl, new CompletedProtoWallet(privateKey))
	}

	async sendMessage(
		recipient: string,
		messageBox: string,
		messageId: string,
		body: unknown,
	): Promise<void> {
		const res = await this.authFetch.fetch(`${this.baseUrl}/sendMessage`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				message: {
					recipient,
					messageBox,
					messageId,
					body,
				},
			}),
		})
		if (!res.ok) {
			const text = await res.text()
			throw new Error(`sendMessage ${res.status}: ${text}`)
		}
	}

	async deliverPayment(
		beefHex: string,
		outputIndex: number,
		pending: PendingPayment,
	): Promise<void> {
		if (!pending.identityPubKey) return

		const msgIdBytes = new Uint8Array(16)
		crypto.getRandomValues(msgIdBytes)
		const messageId = Array.from(msgIdBytes, (x) =>
			x.toString(16).padStart(2, '0'),
		).join('')

		const body: PaymailMessageBody = {
			beef: beefHex,
			outputIndex,
			derivationPrefix: pending.derivationPrefix,
			derivationSuffix: pending.derivationSuffix,
			senderIdentityKey: anyoneIdentityKeyHex(),
			satoshis: pending.satoshis,
			alias: pending.alias,
		}

		await this.sendMessage(
			pending.identityPubKey,
			'payment_inbox',
			messageId,
			body,
		)
	}
}
