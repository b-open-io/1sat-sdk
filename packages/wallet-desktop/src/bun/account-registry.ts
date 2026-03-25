/**
 * Account registry — tracks which wallet accounts exist.
 *
 * Stored as a single JSON value in the config store under "accounts.registry".
 * Each account has a unique ID (first 8 hex chars of SHA-256 of the identity
 * public key), display name, color, and timestamps.
 */
import type { AccountInfo } from '../shared/types'
import { getConfigStore } from './config-store'

const REGISTRY_KEY = 'accounts.registry'

interface RegistryData {
	accounts: AccountInfo[]
	showPickerOnStartup: boolean
	lastActiveAccountId: string | null
}

const DEFAULT_REGISTRY: RegistryData = {
	accounts: [],
	showPickerOnStartup: true,
	lastActiveAccountId: null,
}

let cached: RegistryData | undefined

function read(): RegistryData {
	if (cached) return cached
	const raw = getConfigStore().get(REGISTRY_KEY)
	if (!raw) {
		cached = { ...DEFAULT_REGISTRY, accounts: [] }
		return cached
	}
	try {
		cached = JSON.parse(raw) as RegistryData
		return cached
	} catch {
		cached = { ...DEFAULT_REGISTRY, accounts: [] }
		return cached
	}
}

function write(data: RegistryData): void {
	cached = data
	getConfigStore().set(REGISTRY_KEY, JSON.stringify(data))
}

export function listAccounts(): AccountInfo[] {
	return read().accounts
}

export function getAccount(id: string): AccountInfo | undefined {
	return read().accounts.find((a) => a.id === id)
}

export function addAccount(record: AccountInfo): void {
	const data = read()
	if (data.accounts.some((a) => a.id === record.id)) {
		throw new Error(`Account ${record.id} already exists`)
	}
	data.accounts.push(record)
	write(data)
}

export function updateAccount(
	id: string,
	patch: Partial<Pick<AccountInfo, 'displayName' | 'color'>>,
): void {
	const data = read()
	const account = data.accounts.find((a) => a.id === id)
	if (!account) throw new Error(`Account ${id} not found`)
	if (patch.displayName !== undefined) account.displayName = patch.displayName
	if (patch.color !== undefined) account.color = patch.color
	write(data)
}

export function removeAccount(id: string): void {
	const data = read()
	data.accounts = data.accounts.filter((a) => a.id !== id)
	if (data.lastActiveAccountId === id) {
		data.lastActiveAccountId = data.accounts[0]?.id ?? null
	}
	write(data)
}

export function touchAccount(id: string): void {
	const data = read()
	const account = data.accounts.find((a) => a.id === id)
	if (account) {
		account.lastUsedAt = new Date().toISOString()
		write(data)
	}
}

export function getLastActiveAccountId(): string | null {
	return read().lastActiveAccountId
}

export function setLastActiveAccountId(id: string): void {
	const data = read()
	data.lastActiveAccountId = id
	write(data)
}

export function getShowPickerOnStartup(): boolean {
	return read().showPickerOnStartup
}

export function setShowPickerOnStartup(show: boolean): void {
	const data = read()
	data.showPickerOnStartup = show
	write(data)
}

export function getRegistryAccountCount(): number {
	return read().accounts.length
}
