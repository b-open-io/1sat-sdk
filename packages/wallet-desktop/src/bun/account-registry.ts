/** Cross-process-safe account registry backed by the desktop config store. */
import { Utils } from 'electrobun/bun'
import type { AccountInfo } from '../shared/types'
import { AccountRegistry } from './account-registry-core'
import { getConfigStore } from './config-store'

let registry: AccountRegistry | undefined

function getRegistry(): AccountRegistry {
	if (!registry) {
		registry = new AccountRegistry(
			getConfigStore(),
			`${Utils.paths.userData}/accounts`,
		)
	}
	return registry
}

export function reloadAccountRegistry(): void {
	getRegistry().reload()
}

export function listAccounts(): AccountInfo[] {
	return getRegistry().listAccounts()
}

export function getAccount(id: string): AccountInfo | undefined {
	return getRegistry().getAccount(id)
}

export function getFreshAccount(id: string): Promise<AccountInfo | undefined> {
	return getRegistry().getFreshAccount(id)
}

export function addAccount(
	record: AccountInfo,
	makeActive = false,
): Promise<void> {
	return getRegistry().addAccount(record, makeActive)
}

export function updateAccount(
	id: string,
	patch: Partial<Pick<AccountInfo, 'displayName' | 'color'>>,
): Promise<void> {
	return getRegistry().updateAccount(id, patch)
}

export function removeAccount(id: string): Promise<void> {
	return getRegistry().removeAccount(id)
}

export function touchAccount(id: string): Promise<void> {
	return getRegistry().touchAccount(id)
}

export function activateAccount(id: string): Promise<void> {
	return getRegistry().activateAccount(id)
}

export function getLastActiveAccountId(): string | null {
	return getRegistry().getLastActiveAccountId()
}

export function setLastActiveAccountId(id: string): Promise<void> {
	return getRegistry().setLastActiveAccountId(id)
}

export function getShowPickerOnStartup(): boolean {
	return getRegistry().getShowPickerOnStartup()
}

export function setShowPickerOnStartup(show: boolean): Promise<void> {
	return getRegistry().setShowPickerOnStartup(show)
}

export function getRegistryAccountCount(): number {
	return getRegistry().getAccountCount()
}
