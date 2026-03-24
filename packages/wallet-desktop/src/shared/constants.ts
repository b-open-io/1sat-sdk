/** BRC-100 wallet server ports — shared between Bun and WebView */
export const WALLET_HTTP_PORT = 3321
export const WALLET_HTTPS_PORT = 2121
export const WALLET_HOST = '127.0.0.1'

/** Base URL for the wallet HTTP server (used by AI chat transport, model fetch, etc.) */
export const WALLET_HTTP_URL = `http://${WALLET_HOST}:${WALLET_HTTP_PORT}`

/** Base URL for the local 1sat-stack overlay node */
export const STACK_URL = `http://${WALLET_HOST}:8080`

/** MCP (Model Context Protocol) server port */
export const WALLET_MCP_PORT = 3322

// ---------------------------------------------------------------------------
// Browser settings
// ---------------------------------------------------------------------------

export type SearchMode = 'ai' | 'duckduckgo' | 'google' | 'custom'

export interface BrowserSettings {
	searchMode: SearchMode
	customSearchUrl?: string // template with {query} placeholder
}

const BROWSER_SETTINGS_KEY = '1sat-browser-settings'

export function loadBrowserSettings(): BrowserSettings {
	try {
		const raw = localStorage.getItem(BROWSER_SETTINGS_KEY)
		if (raw) return JSON.parse(raw) as BrowserSettings
	} catch {
		// ignore parse errors
	}
	return { searchMode: 'ai' }
}

export function saveBrowserSettings(settings: BrowserSettings): void {
	localStorage.setItem(BROWSER_SETTINGS_KEY, JSON.stringify(settings))
}
