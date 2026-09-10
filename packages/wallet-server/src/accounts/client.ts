/**
 * Browser/CLI client for the host account routes (status, register,
 * profile). Storage payment lives on its own BRC-41 flow and is not
 * wrapped here.
 */

import type { WalletInterface } from '@bsv/sdk'
import { AuthFetch } from '@bsv/sdk'
import type { AccountView } from './registrationRoutes.js'
import type { AccountStatusResponse } from './types.js'

export interface AccountRegisterInput {
	username: string
	displayName?: string
	avatarOrigin?: string
}

export interface AccountProfileInput {
	/** `null` clears the field. */
	displayName?: string | null
	avatarOrigin?: string | null
}

export type DirectCertificate = {
	type: string
	certifier: string
	acquisitionProtocol: 'direct'
	fields: Record<string, string>
	serialNumber: string
	revocationOutpoint: string
	signature: string
	keyringRevealer: 'certifier'
	keyringForSubject: Record<string, string>
	subject: string
}

export type AccountRegisterResult = AccountView & {
	identityKey: string
	certificate?: DirectCertificate
}

export interface AccountCertifyInput {
	name: string
	domain: string
	outpoint: string
}

export interface AccountCertifyResult {
	handle: string
	domain: string
	revocationOutpoint: string
	certificate: DirectCertificate
}

export class AccountClient {
	private auth: AuthFetch

	constructor(
		private baseUrl: string,
		wallet: WalletInterface,
	) {
		this.baseUrl = baseUrl.replace(/\/$/, '')
		this.auth = new AuthFetch(wallet)
	}

	async getStatus(): Promise<AccountStatusResponse> {
		const res = await this.auth.fetch(`${this.baseUrl}/account/status`)
		if (!res.ok) throw new Error(`account/status ${res.status}`)
		return res.json() as Promise<AccountStatusResponse>
	}

	async register(input: AccountRegisterInput): Promise<AccountRegisterResult> {
		return this.send('POST', '/account/register', input)
	}

	async updateProfile(
		input: AccountProfileInput,
	): Promise<AccountRegisterResult> {
		return this.send('PUT', '/account/profile', input)
	}

	async certify(input: AccountCertifyInput): Promise<AccountCertifyResult> {
		const res = await this.auth.fetch(`${this.baseUrl}/account/certify`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(input),
		})
		if (!res.ok) {
			const text = await res.text()
			let message = text
			try {
				message = (JSON.parse(text) as { error?: string }).error ?? text
			} catch {}
			throw new Error(message || `account/certify ${res.status}`)
		}
		return res.json() as Promise<AccountCertifyResult>
	}

	private async send(
		method: 'POST' | 'PUT',
		path: string,
		body: unknown,
	): Promise<AccountRegisterResult> {
		const res = await this.auth.fetch(`${this.baseUrl}${path}`, {
			method,
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body),
		})
		if (!res.ok) {
			const text = await res.text()
			let message = text
			try {
				message = (JSON.parse(text) as { error?: string }).error ?? text
			} catch {}
			throw new Error(message || `${path} ${res.status}`)
		}
		return res.json() as Promise<AccountRegisterResult>
	}
}
