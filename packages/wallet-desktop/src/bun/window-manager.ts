/**
 * Window manager — one BrowserWindow per account, singleton pattern.
 *
 * Each account gets its own window with full browser chrome and wallet RPC.
 * The picker window is the launcher — it stays open and spawns account windows.
 * Account windows are tracked by accountId and focused if already open.
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

/** Map of accountId → open BrowserWindow */
const accountWindows = new Map<string, BrowserWindow>()

/** The picker/launcher window (set by index.ts) */
let pickerWindow: BrowserWindow | undefined

// ============================================================================
// Public API
// ============================================================================

export function setPickerWindow(win: BrowserWindow): void {
	pickerWindow = win
}

export function getPickerWindow(): BrowserWindow | undefined {
	return pickerWindow
}

/** Create a fresh BrowserWindow for an account (used for 2nd+ accounts). */
function createNewAccountWindow(accountId: string): BrowserWindow {
	const handlers = createRpcHandlers()
	const rpc = BrowserView.defineRPC<WalletDesktopRPC>({
		maxRequestTime: 60000,
		handlers: {
			requests: {
				...handlers,
				toggleDevTools: () => {
					try {
						const w = accountWindows.get(accountId)
						w?.webview.toggleDevTools()
					} catch (err) {
						console.error('Failed to toggle dev tools:', err)
					}
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

	return new BrowserWindow({
		title: '1Sat',
		url: 'views://mainview/index.html',
		frame: {
			width: 1440,
			height: 900,
			x: 120 + accountWindows.size * 30,
			y: 120 + accountWindows.size * 30,
		},
		titleBarStyle: 'hiddenInset',
		rpc,
	})
}

/**
 * Open a window for an account, or focus the existing one.
 * Returns true if a new window was created, false if focused existing.
 */
export async function openAccountWindow(accountId: string): Promise<boolean> {
	// Singleton: if window already open, just focus it
	const existing = accountWindows.get(accountId)
	if (existing) {
		existing.show()
		existing.focus()
		return false
	}

	const log = createLogger({ context: 'window-manager' })
	log.set({ event: 'opening_account_window', accountId })
	log.emit()

	// If this is the first account being opened and the picker window exists,
	// reuse the picker window instead of creating a new one.
	// This avoids the "empty picker stuck at the bottom" problem.
	const reusePickerWindow = pickerWindow && accountWindows.size === 0
	const win = reusePickerWindow ? pickerWindow! : createNewAccountWindow(accountId)

	accountWindows.set(accountId, win)

	// Wire wallet callbacks to push to this window's RPC.
	// When reusing the picker window, use the legacy callbacks that index.ts
	// already wired to mainWindow's RPC. For new windows, push via the new window's RPC.
	const callbacks: WalletCallbacks = reusePickerWindow
		? getLegacyCallbacks()
		: {
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

	if (!reusePickerWindow) {
		// Only wire close/popup handlers for new windows
		// (picker window already has these from index.ts)
		win.on('close', () => {
			log.set({ event: 'account_window_closed', accountId })
			log.emit()
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
	}

	// Unlock the wallet for this account (triggers Touch ID)
	try {
		await unlock(accountId, '', callbacks)
		touchAccount(accountId)
		setLastActiveAccountId(accountId)

		if (reusePickerWindow) {
			// Picker window DOM is already ready — push status immediately
			try { win.webview.rpc.send.walletStateChanged({ status: 'unlocked' }) } catch {}
		} else {
			// New window — wait for DOM to be ready
			win.webview.on('dom-ready', () => {
				try { win.webview.rpc.send.walletStateChanged({ status: 'unlocked' }) } catch {}
			})
		}
	} catch (err) {
		log.set({ event: 'account_unlock_failed', accountId, error: err instanceof Error ? err.message : String(err) })
		log.emit()
		// Close the window if unlock failed (user cancelled Touch ID)
		accountWindows.delete(accountId)
		// Can't close programmatically easily — leave it, the user can close manually
	}

	return true
}

/**
 * Focus an existing account window.
 */
export function focusAccountWindow(accountId: string): boolean {
	const win = accountWindows.get(accountId)
	if (!win) return false
	win.show()
	win.focus()
	return true
}

/**
 * Close an account window.
 */
export function closeAccountWindow(accountId: string): void {
	const win = accountWindows.get(accountId)
	if (win) {
		accountWindows.delete(accountId)
		lockAccount(accountId).catch(() => {})
	}
}

/**
 * Check if a window is open for an account.
 */
export function isWindowOpen(accountId: string): boolean {
	return accountWindows.has(accountId)
}

/**
 * Get all open account window IDs.
 */
export function getOpenWindowAccountIds(): string[] {
	return Array.from(accountWindows.keys())
}
