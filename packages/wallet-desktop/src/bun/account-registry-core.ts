import type { AccountInfo } from '../shared/types'
import { withStorageLifecycleLock } from './storage-identity'

const REGISTRY_KEY = 'accounts.registry'

export interface RegistryData {
	accounts: AccountInfo[]
	showPickerOnStartup: boolean
	lastActiveAccountId: string | null
}

export interface RegistryStore {
	get(key: string): string | undefined
	set(key: string, value: string): void
}

const DEFAULT_REGISTRY: RegistryData = {
	accounts: [],
	showPickerOnStartup: true,
	lastActiveAccountId: null,
}

function cloneRegistry(data: RegistryData): RegistryData {
	return {
		accounts: data.accounts.map((account) => ({ ...account })),
		showPickerOnStartup: data.showPickerOnStartup,
		lastActiveAccountId: data.lastActiveAccountId,
	}
}

export class AccountRegistry {
	private cached: RegistryData | undefined

	constructor(
		private readonly store: RegistryStore,
		private readonly accountsRoot: string,
	) {}

	reload(): void {
		this.cached = undefined
	}

	private read(): RegistryData {
		if (this.cached) return this.cached
		const raw = this.store.get(REGISTRY_KEY)
		if (!raw) {
			this.cached = cloneRegistry(DEFAULT_REGISTRY)
			return this.cached
		}
		try {
			this.cached = JSON.parse(raw) as RegistryData
			return this.cached
		} catch {
			this.cached = cloneRegistry(DEFAULT_REGISTRY)
			return this.cached
		}
	}

	private write(data: RegistryData): void {
		this.store.set(REGISTRY_KEY, JSON.stringify(data))
		this.cached = data
	}

	private async mutate<T>(operation: (data: RegistryData) => T): Promise<T> {
		return withStorageLifecycleLock(this.accountsRoot, () => {
			this.reload()
			const data = cloneRegistry(this.read())
			const result = operation(data)
			this.write(data)
			return result
		})
	}

	listAccounts(): AccountInfo[] {
		return this.read().accounts.map((account) => ({ ...account }))
	}

	getAccount(id: string): AccountInfo | undefined {
		const account = this.read().accounts.find(
			(candidate) => candidate.id === id,
		)
		return account ? { ...account } : undefined
	}

	async getFreshAccount(id: string): Promise<AccountInfo | undefined> {
		return withStorageLifecycleLock(this.accountsRoot, () => {
			this.reload()
			return this.getAccount(id)
		})
	}

	async addAccount(record: AccountInfo, makeActive = false): Promise<void> {
		await this.mutate((data) => {
			if (data.accounts.some((account) => account.id === record.id)) {
				throw new Error(`Account ${record.id} already exists`)
			}
			data.accounts.push({ ...record })
			if (makeActive) data.lastActiveAccountId = record.id
		})
	}

	async updateAccount(
		id: string,
		patch: Partial<Pick<AccountInfo, 'displayName' | 'color'>>,
	): Promise<void> {
		await this.mutate((data) => {
			const account = data.accounts.find((candidate) => candidate.id === id)
			if (!account) throw new Error(`Account ${id} not found`)
			if (patch.displayName !== undefined)
				account.displayName = patch.displayName
			if (patch.color !== undefined) account.color = patch.color
		})
	}

	async removeAccount(id: string): Promise<void> {
		await this.mutate((data) => {
			data.accounts = data.accounts.filter((account) => account.id !== id)
			if (data.lastActiveAccountId === id) {
				data.lastActiveAccountId = data.accounts[0]?.id ?? null
			}
		})
	}

	async touchAccount(id: string): Promise<void> {
		await this.mutate((data) => {
			const account = data.accounts.find((candidate) => candidate.id === id)
			if (account) account.lastUsedAt = new Date().toISOString()
		})
	}

	async activateAccount(id: string): Promise<void> {
		await this.mutate((data) => {
			const account = data.accounts.find((candidate) => candidate.id === id)
			if (!account) throw new Error(`Account ${id} not found`)
			account.lastUsedAt = new Date().toISOString()
			data.lastActiveAccountId = id
		})
	}

	getLastActiveAccountId(): string | null {
		return this.read().lastActiveAccountId
	}

	async setLastActiveAccountId(id: string): Promise<void> {
		await this.mutate((data) => {
			data.lastActiveAccountId = id
		})
	}

	getShowPickerOnStartup(): boolean {
		return this.read().showPickerOnStartup
	}

	async setShowPickerOnStartup(show: boolean): Promise<void> {
		await this.mutate((data) => {
			data.showPickerOnStartup = show
		})
	}

	getAccountCount(): number {
		return this.read().accounts.length
	}
}
