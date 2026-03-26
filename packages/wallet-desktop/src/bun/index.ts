/**
 * 1Sat — Bun process entry point.
 *
 * Creates the desktop window, wires RPC handlers, sets up the
 * application menu, and boots the wallet lifecycle.
 */
import './log' // Side-effect: initializes evlog FIRST — file drain + ring buffer
import { createLogger } from 'evlog'
import { flushLogs, setSyncDrainCallback } from './log'
import Electrobun, {
	ApplicationMenu,
	BrowserView,
	BrowserWindow,
	Utils,
	Updater,
} from 'electrobun/bun'
import type { WalletDesktopRPC } from '../shared/types'
import { setChatMessageCallback, shutdownChatManager } from './chat-manager'
import {
	resolvePermission,
	setPermissionPusher,
	startWalletServer,
	stopWalletServer,
} from './http-server'
import { closeConfigStore } from './config-store'
import { closeMcpClient } from './mcp/client'
import { startMcpServer, stopMcpServer } from './mcp/server'
import { startStack, stopStack } from './sidecar-manager'
import { createRpcHandlers } from './rpc-handlers'
import {
	checkForUpdatesManual,
	checkForUpdatesOnLaunch,
	setUpdateStatusPusher,
	startBackgroundUpdateCheck,
	stopBackgroundUpdateCheck,
} from './updater'
import { initVaultChannel, legacyVaultLabel } from './vault-manager'
import { setMainWindow } from './window-manager'
import {
	listAccounts,
	getShowPickerOnStartup,
	getLastActiveAccountId,
	addAccount,
	setLastActiveAccountId,
	setShowPickerOnStartup as setPickerPref,
} from './account-registry'
import {
	checkVault,
	migrateLegacyWallet,
	setBalanceUpdatedCallback,
	setInitialStatus,
	setStatusChangedCallback,
	setSyncEventCallback,
} from './wallet-manager'

// ============================================================================
// Build channel — drives vault label + HMR detection
// ============================================================================

let buildChannel = 'stable'
try {
	buildChannel = await Updater.localInfo.channel()
} catch (err) {
	const log = createLogger({ context: 'startup' })
	log.set({ event: 'channel_detection_failed', error: err instanceof Error ? err.message : String(err) })
	log.emit()
}

// Each channel gets its own Secure Enclave key namespace
initVaultChannel(buildChannel)

// ============================================================================
// Migration: single-account → multi-account
// ============================================================================

if (listAccounts().length === 0) {
	const log = createLogger({ context: 'migration' })

	// Phase 1: Try legacy single-account migration (v0.0.8 and earlier)
	try {
		const migrationResult = await migrateLegacyWallet(legacyVaultLabel())
			?? await migrateLegacyWallet('1sat-wallet-root-key')
		if (migrationResult) {
			addAccount({
				id: migrationResult.accountId,
				identityKey: migrationResult.identityKey,
				displayName: 'Account 1',
				color: 'amber',
				createdAt: new Date().toISOString(),
				lastUsedAt: new Date().toISOString(),
			})
			setLastActiveAccountId(migrationResult.accountId)
			setPickerPref(true)
			log.set({ event: 'legacy_migrated', accountId: migrationResult.accountId })
			log.emit()
		}
	} catch (err) {
		log.set({ event: 'migration_failed', error: err instanceof Error ? err.message : String(err) })
		log.emit()
	}

	// Phase 2: Recover orphaned accounts — vault entries that exist but
	// have no registry entry (e.g. config.db moved to new path)
	if (listAccounts().length === 0) {
		try {
			const { recoverOrphanedAccounts } = await import('./wallet-manager')
			const recovered = await recoverOrphanedAccounts()
			if (recovered > 0) {
				const rlog = createLogger({ context: 'migration' })
				rlog.set({ event: 'orphans_recovered', count: recovered })
				rlog.emit()
			}
		} catch (err) {
			const rlog = createLogger({ context: 'migration' })
			rlog.set({ event: 'orphan_recovery_failed', error: err instanceof Error ? err.message : String(err) })
			rlog.emit()
		}
	}
}

// ============================================================================
// Dev server detection (HMR support)
// ============================================================================

const DEV_SERVER_PORT = 5173
const DEV_SERVER_URL = `http://localhost:${DEV_SERVER_PORT}`

async function getMainViewUrl(): Promise<string> {
	if (buildChannel === 'dev') {
		try {
			await fetch(DEV_SERVER_URL, { method: 'HEAD' })
			const log = createLogger({ context: 'startup' })
			log.set({ event: 'hmr_enabled', devServerUrl: DEV_SERVER_URL })
			log.emit()
			return DEV_SERVER_URL
		} catch {
			const log = createLogger({ context: 'startup' })
			log.set({ event: 'hmr_unavailable', hint: "Run 'bun run dev:hmr' for HMR support" })
			log.emit()
		}
	}
	return 'views://mainview/index.html'
}

// ============================================================================
// RPC
// ============================================================================

const handlers = createRpcHandlers()

const rpc = BrowserView.defineRPC<WalletDesktopRPC>({
	maxRequestTime: 60000, // 60s — wallet ops + Touch ID can be slow
	handlers: {
		requests: {
			...handlers,
			resolvePermission,
			toggleDevTools: () => {
				try {
					mainWindow.webview.toggleDevTools()
				} catch (err) {
					console.error('Failed to toggle dev tools:', err)
				}
				return { success: true }
			},
			toggleMaximize: () => {
				if (mainWindow.isMaximized()) {
					mainWindow.unmaximize()
				} else {
					mainWindow.maximize()
				}
				return { success: true }
			},
			openOrdfsContent: ({ path }: { path: string }) => {
				const contentUrl = `https://ordfs.network/${path}`
				const log = createLogger({ context: 'rpc' })
				log.set({ event: 'open_ordfs_content', path, contentUrl })
				log.emit()
				new BrowserWindow({
					title: `1Sat: ${path.substring(0, 16)}...`,
					url: contentUrl,
					frame: { width: 900, height: 700, x: 150, y: 150 },
				})
				return { success: true }
			},
			openBrowserWindow: ({
				url,
				title,
			}: { url: string; title?: string }) => {
				if (!browserWindow || browserWindow.isMinimized?.()) {
					browserWindow = new BrowserWindow({
						title: title ?? url.substring(0, 40),
						url,
						frame: { width: 1200, height: 800, x: 150, y: 100 },
					})
					browserWindow.on('close', () => {
						browserWindow = undefined
					})
				} else {
					browserWindow.webview.loadURL(url)
					if (title) browserWindow.setTitle(title)
					browserWindow.focus()
				}
				return { success: true }
			},
		},
		messages: {},
	},
})

// ============================================================================
// Application window
// ============================================================================

// Persistent browser window — reused for all URL opens
let browserWindow: BrowserWindow | undefined

let url: string
try {
	url = await getMainViewUrl()
	const log = createLogger({ context: 'startup' })
	log.set({ event: 'url_resolved', url })
	log.emit()
} catch (err) {
	const log = createLogger({ context: 'startup' })
	log.set({ event: 'url_resolve_failed', error: err instanceof Error ? err.message : String(err) })
	log.emit()
	throw err
}

let mainWindow: BrowserWindow
try {
	mainWindow = new BrowserWindow({
		title: '1Sat',
		url,
		frame: { width: 1440, height: 900, x: 100, y: 100 },
		titleBarStyle: 'hiddenInset',
		rpc,
	})
	setMainWindow(mainWindow)
	const log = createLogger({ context: 'startup' })
	log.set({ event: 'window_created', url })
	log.emit()
} catch (err) {
	const log = createLogger({ context: 'startup' })
	log.set({ event: 'window_create_failed', url, error: err instanceof Error ? err.message : String(err) })
	log.emit()
	throw err
}

// ============================================================================
// Popup / new window handling
// ============================================================================

mainWindow.webview.on('new-window-open', (e) => {
	const data = typeof e.data === 'string' ? { url: e.data } : e.data
	const popupUrl = data?.url
	if (!popupUrl) return

	const log = createLogger({ context: 'popup' })
	log.set({ event: 'new_window_open', url: popupUrl })
	log.emit()

	new BrowserWindow({
		title: new URL(popupUrl).hostname,
		url: popupUrl,
		frame: { width: 900, height: 700, x: 150, y: 150 },
	})
})

// ============================================================================
// Application menu
// ============================================================================

ApplicationMenu.setApplicationMenu([
	{
		label: '1Sat',
		submenu: [
			{ label: 'About 1Sat', role: 'about' },
			{ label: 'Check for Updates...', action: 'check-updates' },
			{ type: 'separator' },
			{ role: 'hide' },
			{ role: 'hideOthers' },
			{ role: 'showAll' },
			{ type: 'separator' },
			{ label: 'Quit 1Sat', action: 'quit', accelerator: 'q' },
		],
	},
	{
		label: 'Edit',
		submenu: [
			{ role: 'undo' },
			{ role: 'redo' },
			{ type: 'separator' },
			{ role: 'cut' },
			{ role: 'copy' },
			{ role: 'paste' },
			{ role: 'selectAll' },
		],
	},
	{
		label: 'Tab',
		submenu: [
			{ label: 'New Tab', action: 'new-tab', accelerator: 'meta+t' },
			{ label: 'Close Tab', action: 'close-tab', accelerator: 'meta+w' },
			{ type: 'separator' },
			{ label: 'Next Tab', action: 'next-tab', accelerator: 'shift+meta+]' },
			{ label: 'Previous Tab', action: 'prev-tab', accelerator: 'shift+meta+[' },
		],
	},
	{
		label: 'View',
		submenu: [
			{ role: 'toggleFullScreen' },
			{ type: 'separator' },
			{
				label: 'Toggle Developer Tools',
				action: 'toggle-devtools',
				accelerator: 'shift+meta+i',
			},
			{
				label: 'Toggle Sync Log',
				action: 'toggle-sync-log',
				accelerator: 'shift+meta+j',
			},
		],
	},
])

// ============================================================================
// Menu actions
// ============================================================================

Electrobun.events.on('application-menu-clicked', (e) => {
	if (e.data.action === 'quit') {
		stopBackgroundUpdateCheck()
		shutdownChatManager()
		closeMcpClient()
		stopMcpServer()
		stopStack()
		closeConfigStore()
		flushLogs().finally(() => Utils.quit())
	}
	if (e.data.action === 'toggle-devtools') {
		mainWindow.webview.toggleDevTools()
	}
	if (e.data.action === 'toggle-sync-log') {
		mainWindow.webview.rpc.send.toggleSyncLog({})
	}
	if (e.data.action === 'check-updates') {
		checkForUpdatesManual()
	}
	if (e.data.action === 'new-tab') {
		mainWindow.webview.rpc.send.menuAction({ action: 'new-tab' })
	}
	if (e.data.action === 'close-tab') {
		mainWindow.webview.rpc.send.menuAction({ action: 'close-tab' })
	}
	if (e.data.action === 'next-tab') {
		mainWindow.webview.rpc.send.menuAction({ action: 'next-tab' })
	}
	if (e.data.action === 'prev-tab') {
		mainWindow.webview.rpc.send.menuAction({ action: 'prev-tab' })
	}
})

// ============================================================================
// Graceful shutdown on SIGTERM (electrobun watcher restart)
// ============================================================================

process.on('SIGTERM', () => {
	shutdownChatManager()
	closeMcpClient()
	stopMcpServer()
	stopWalletServer()
	stopStack()
	closeConfigStore()
	flushLogs().finally(() => process.exit(0))
})

// ============================================================================
// Wallet lifecycle
// ============================================================================

// Push wallet status changes to the WebView
setStatusChangedCallback((status) => {
	mainWindow.webview.rpc.send.walletStateChanged({ status })
})

// Push balance updates to the WebView
setBalanceUpdatedCallback((balance) => {
	mainWindow.webview.rpc.send.balanceUpdated(balance)
})

// Push sync events to the WebView
setSyncEventCallback((event) => {
	mainWindow.webview.rpc.send.syncEvent(event)
})

// Pipe evlog events to the sync terminal too
setSyncDrainCallback((event) => {
	try { mainWindow.webview.rpc.send.syncEvent(event) } catch {}
})

// Push incoming chat messages to the WebView
setChatMessageCallback((msg) => {
	mainWindow.webview.rpc.send.chatMessageReceived(msg)
})

// Push update status changes to the WebView
setUpdateStatusPusher((status, version, error) => {
	mainWindow.webview.rpc.send.updateStatus({ status, version, error })
})

// Determine initial state based on account registry (read fresh on dom-ready)
mainWindow.webview.on('dom-ready', () => {
	const currentAccounts = listAccounts()
	const log = createLogger({ context: 'startup' })
	log.set({ event: 'dom_ready', url, accountCount: currentAccounts.length })
	log.emit()

	if (currentAccounts.length === 0) {
		// Fresh install or failed migration
		setInitialStatus('no-wallet')
		mainWindow.webview.rpc.send.walletStateChanged({ status: 'no-wallet' })
	} else if (currentAccounts.length === 1 && !getShowPickerOnStartup()) {
		// Single account with picker disabled — auto-unlock
		setInitialStatus('locked')
		mainWindow.webview.rpc.send.accountsLoaded({ accounts: currentAccounts })
		mainWindow.webview.rpc.send.walletStateChanged({ status: 'locked' })
	} else {
		// Show profile picker
		setInitialStatus('account-selection')
		mainWindow.webview.rpc.send.accountsLoaded({ accounts: currentAccounts })
		mainWindow.webview.rpc.send.walletStateChanged({ status: 'account-selection' })
	}

	// Auto-update: check on launch (non-blocking), then hourly in the background
	checkForUpdatesOnLaunch()
	startBackgroundUpdateCheck()
})

// ============================================================================
// BRC-100 HTTP server for dApp connectivity
// ============================================================================

// Wire the permission pusher so the HTTP server can route approval requests
// through the WebView permission dialog.
setPermissionPusher((request) => {
	// Bring wallet window above all other windows so the permission dialog is visible
	mainWindow.setAlwaysOnTop(true)
	mainWindow.show()
	mainWindow.focus()
	// Release always-on-top after a brief moment so it doesn't stay pinned
	setTimeout(() => mainWindow.setAlwaysOnTop(false), 500)
	mainWindow.webview.rpc.send.permissionRequest(request)
})

startWalletServer()
startMcpServer(mainWindow)

// Start the 1sat-stack sidecar (non-blocking — wallet does not depend on it)
startStack().catch((err) => {
	console.error('1sat-stack sidecar failed to start:', err instanceof Error ? err.message : err)
})

// ============================================================================
// 1sat:// deep link handler + ORDFS content viewer
// ============================================================================

function openOrdfsWindow(path: string): void {
	const contentUrl = `https://ordfs.network/${path}`
	const log = createLogger({ context: 'ordfs' })
	log.set({ event: 'open_window', path, contentUrl })
	log.emit()

	new BrowserWindow({
		title: `1Sat: ${path.substring(0, 16)}...`,
		url: contentUrl,
		frame: { width: 900, height: 700, x: 150, y: 150 },
	})
}

// Handle 1sat:// and bap:// deep links from the OS
Electrobun.events.on('open-url', (e) => {
	const url = e.data.url
	const log = createLogger({ context: 'deep-link' })
	log.set({ event: 'received', url })
	log.emit()

	// Bring the wallet window to the front
	mainWindow.show()
	mainWindow.focus()

	if (url.startsWith('1sat://')) {
		mainWindow.webview.rpc.send.navigateToUrl({ url })
	} else if (url.startsWith('bap://')) {
		// bap://bapId[/action] — identity deep links
		const path = url.slice('bap://'.length)
		const segments = path.split('?')[0].split('/')
		const bapId = segments[0]
		const action = segments[1] // 'message', 'follow', or undefined

		if (!bapId || !/^[1-9A-HJ-NP-Za-km-z]{10,50}$/.test(bapId)) return

		if (action === 'message') {
			mainWindow.webview.rpc.send.navigateToUrl({
				url: `1sat://dm?bapId=${bapId}`,
			})
		} else {
			// Default: open profile (follow action initiated from profile UI)
			mainWindow.webview.rpc.send.navigateToUrl({
				url: `1sat://identity/profile?bapId=${bapId}`,
			})
		}
	}
})

const startupLog = createLogger({ context: 'startup' })
startupLog.set({ event: 'started', service: '1sat-wallet' })
startupLog.emit()
