/**
 * Window manager — one BrowserWindow per account, singleton pattern.
 *
 * The picker window is reused for the first account. Subsequent accounts
 * get new windows. Selecting an already-open account focuses its window.
 */
import {
	BrowserView,
	BrowserWindow,
} from 'electrobun/bun'
import { createLogger } from 'evlog'
import type { WalletDesktopRPC } from '../shared/types'
import { touchAccount, setLastActiveAccountId } from './account-registry'
import { createRpcHandlers } from './rpc-handlers'
import { unlock, lockAccount, getLegacyCallbacks, type WalletCallbacks } from './wallet-manager'

// ============================================================================
// State
// ============================================================================

/** Map of accountId → BrowserWindow */
const accountWindows = new Map<string, BrowserWindow>()

/** The main window created by index.ts */
let mainWindow: BrowserWindow | undefined

/** Which accountId owns the main window (set on first selection) */
let mainWindowAccountId: string | undefined

// ============================================================================
// Public API
// ============================================================================

export function setMainWindow(win: BrowserWindow): void {
	mainWindow = win
}

/**
 * Open a window for an account. Singleton — focuses existing if already open.
 */
export async function openAccountWindow(accountId: string): Promise<boolean> {
	const log = createLogger({ context: 'window-manager' })

	// 1. Already open? Focus it.
	const existing = accountWindows.get(accountId)
	if (existing) {
		log.set({ event: 'focus_existing', accountId, windowCount: accountWindows.size })
		log.emit()
		try {
			existing.focus()
		} catch (err) {
			const errLog = createLogger({ context: 'window-manager' })
			errLog.set({ event: 'focus_failed', accountId, error: err instanceof Error ? err.message : String(err) })
			errLog.emit()
		}
		return false
	}

	// 2. First account? Reuse the main window.
	if (mainWindow && !mainWindowAccountId) {
		log.set({ event: 'reuse_main_window', accountId })
		log.emit()

		mainWindowAccountId = accountId
		accountWindows.set(accountId, mainWindow)

		// Use the legacy callbacks already wired by index.ts
		const callbacks = getLegacyCallbacks()

		await unlock(accountId, '', callbacks)
		touchAccount(accountId)
		setLastActiveAccountId(accountId)

		// Push unlocked status immediately (DOM is already ready)
		try { mainWindow.webview.rpc.send.walletStateChanged({ status: 'unlocked' }) } catch {}

		// Verify sync event chain is working
		callbacks.onSyncEvent?.({
			timestamp: Date.now(),
			source: 'window-manager',
			level: 'success',
			message: `Account ${accountId} window ready`,
		})

		return true
	}

	// 3. Additional account → new window
	log.set({ event: 'new_window', accountId })
	log.emit()

	const handlers = createRpcHandlers(accountId)
	const rpc = BrowserView.defineRPC<WalletDesktopRPC>({
		maxRequestTime: 60000,
		handlers: {
			requests: {
				...handlers,
				toggleDevTools: () => {
					try { accountWindows.get(accountId)?.webview.toggleDevTools() } catch {}
					return { success: true }
				},
				toggleMaximize: () => {
					const w = accountWindows.get(accountId)
					if (w) {
						if (w.isMaximized()) w.unmaximize()
						else w.maximize()
					}
					return { success: true }
				},
			},
			messages: {},
		},
	})

	const win = new BrowserWindow({
		title: '1Sat',
		url: 'views://mainview/index.html',
		frame: {
			width: 1440,
			height: 900,
			x: 140 + accountWindows.size * 30,
			y: 140 + accountWindows.size * 30,
		},
		titleBarStyle: 'hiddenInset',
		rpc,
	})

	accountWindows.set(accountId, win)

	const callbacks: WalletCallbacks = {
		onStatusChanged: (status) => {
			try { win.webview.rpc.send.walletStateChanged({ status }) } catch {}
		},
		onBalanceUpdated: (balance) => {
			try { win.webview.rpc.send.balanceUpdated(balance) } catch {}
		},
		onSyncEvent: (event) => {
			try { win.webview.rpc.send.syncEvent(event) } catch {}
		},
	}

	win.on('close', () => {
		accountWindows.delete(accountId)
		lockAccount(accountId).catch(() => {})
	})

	win.webview.on('new-window-open', (e) => {
		const data = typeof e.data === 'string' ? { url: e.data } : e.data
		const popupUrl = data?.url
		if (!popupUrl) return
		new BrowserWindow({
			title: new URL(popupUrl).hostname,
			url: popupUrl,
			frame: { width: 900, height: 700, x: 150, y: 150 },
		})
	})

	try {
		await unlock(accountId, '', callbacks)
		touchAccount(accountId)
		setLastActiveAccountId(accountId)

		win.webview.on('dom-ready', () => {
			try { win.webview.rpc.send.walletStateChanged({ status: 'unlocked' }) } catch {}
		})
	} catch (err) {
		log.set({ event: 'unlock_failed', accountId, error: err instanceof Error ? err.message : String(err) })
		log.emit()
		accountWindows.delete(accountId)
	}

	return true
}

export function isWindowOpen(accountId: string): boolean {
	return accountWindows.has(accountId)
}

export function getOpenWindowAccountIds(): string[] {
	return Array.from(accountWindows.keys())
}
