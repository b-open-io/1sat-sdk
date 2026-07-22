/**
 * Browser/CLI client for host-pack routes on wallet serve.
 */

import type { WalletInterface } from '@bsv/sdk'
import { AuthFetch } from '@bsv/sdk'

export interface HostingPrice {
	priceSats: number
	periodSeconds: number
}

export interface HostingStatus {
	enabled: boolean
	identityKey: string
	active: boolean
	expiresAt?: number
	priceSats?: number
	periodSeconds?: number
}

export interface HostingSubscribeResult {
	status: string
	identityKey: string
	expiresAt: number
	txid: string
}

export class HostingClient {
	constructor(
		private baseUrl: string,
		private wallet?: WalletInterface,
	) {
		this.baseUrl = baseUrl.replace(/\/$/, '')
	}

	async getPrice(): Promise<HostingPrice> {
		const res = await fetch(`${this.baseUrl}/hosting/price`)
		if (!res.ok) throw new Error(`hosting/price ${res.status}`)
		return res.json() as Promise<HostingPrice>
	}

	async getStatus(): Promise<HostingStatus> {
		if (!this.wallet) throw new Error('wallet required for status')
		const auth = new AuthFetch(this.wallet)
		const res = await auth.fetch(`${this.baseUrl}/hosting/status`)
		if (!res.ok) throw new Error(`hosting/status ${res.status}`)
		return res.json() as Promise<HostingStatus>
	}

	async subscribe(): Promise<HostingSubscribeResult> {
		if (!this.wallet) throw new Error('wallet required for subscribe')
		const auth = new AuthFetch(this.wallet)
		// AuthFetch retries 402 with payment when wallet can pay.
		const res = await auth.fetch(`${this.baseUrl}/hosting/subscribe`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: '{}',
		})
		if (!res.ok) {
			const text = await res.text()
			throw new Error(`hosting/subscribe ${res.status}: ${text}`)
		}
		return res.json() as Promise<HostingSubscribeResult>
	}
}
