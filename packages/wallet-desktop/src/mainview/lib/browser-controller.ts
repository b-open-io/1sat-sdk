/**
 * Browser controller — singleton registry for tab management.
 *
 * The BrowserView component registers its imperative operations here.
 * RPC handlers call these to control tabs from the Bun process (via MCP tools).
 */
import type { WebviewTagElement } from 'electrobun/view'

export interface BrowserTab {
	id: string
	url: string
	title: string
}

export interface BrowserController {
	listTabs(): BrowserTab[]
	createTab(url?: string): string
	closeTab(tabId: string): boolean
	navigateTab(tabId: string, url: string): boolean
	activateTab(tabId: string): boolean
	goBack(tabId: string): boolean
	goForward(tabId: string): boolean
	reload(tabId: string): boolean
}

let controller: BrowserController | undefined

export function registerBrowserController(ctrl: BrowserController): void {
	controller = ctrl
}

export function unregisterBrowserController(): void {
	controller = undefined
}

export function getBrowserController(): BrowserController | undefined {
	return controller
}
