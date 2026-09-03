import type { ClientOptions } from '@1sat/types'
import { BaseClient } from './BaseClient.js'

export class AdminClient extends BaseClient {
	constructor(baseUrl: string, options: ClientOptions = {}) {
		super(`${baseUrl}/1sat/admin/api`, options)
	}

	async getSetupStatus(): Promise<{ configured: boolean }> {
		return this.request<{ configured: boolean }>('/status')
	}

	async setup(): Promise<{ message: string }> {
		return this.request<{ message: string }>('/setup', { method: 'POST' })
	}

	async getWhitelist(): Promise<string[]> {
		return this.request<string[]>('/whitelist')
	}

	async addToWhitelist(
		topic: string,
	): Promise<{ message: string; token: string }> {
		return this.request<{ message: string; token: string }>('/whitelist', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ topic }),
		})
	}

	async removeFromWhitelist(
		token: string,
	): Promise<{ message: string; token: string }> {
		return this.request<{ message: string; token: string }>(
			`/whitelist/${encodeURIComponent(token)}`,
			{ method: 'DELETE' },
		)
	}

	async getBlacklist(): Promise<string[]> {
		return this.request<string[]>('/blacklist')
	}

	async addToBlacklist(
		topic: string,
	): Promise<{ message: string; topic: string }> {
		return this.request<{ message: string; topic: string }>('/blacklist', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ topic }),
		})
	}

	async removeFromBlacklist(
		topic: string,
	): Promise<{ message: string; topic: string }> {
		return this.request<{ message: string; topic: string }>(
			`/blacklist/${encodeURIComponent(topic)}`,
			{ method: 'DELETE' },
		)
	}

	async getActiveTopics(): Promise<string[]> {
		return this.request<string[]>('/topics/active')
	}

	async getActiveLookups(): Promise<string[]> {
		return this.request<string[]>('/lookups/active')
	}

	async getProgress(): Promise<Array<{ id: string; block: number }>> {
		return this.request<Array<{ id: string; block: number }>>('/progress')
	}
}
