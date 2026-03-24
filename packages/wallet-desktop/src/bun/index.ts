/**
 * 1Sat — Bun process entry point.
 *
 * Creates the desktop window, wires RPC handlers, sets up the
 * application menu, and boots the wallet lifecycle.
 */
import { createLogger } from 'evlog'
import './log' // Side-effect: initializes evlog with file drain + ring buffer
import { flushLogs } from './log'
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
} from './http-server'
import { closeMcpClient } from './mcp/client'
import { startMcpServer, stopMcpServer } from './mcp/server'
import { createRpcHandlers } from './rpc-handlers'
import {
	getStackUrl,
	isStackSetupComplete,
	startStack,
	stopStack,
} from './sidecar-manager'
import {
	checkVault,
	setBalanceUpdatedCallback,
	setStatusChangedCallback,
	setSyncEventCallback,
} from './wallet-manager'

// ============================================================================
// Dev server detection (HMR support)
// ============================================================================

const DEV_SERVER_PORT = 5173
const DEV_SERVER_URL = `http://localhost:${DEV_SERVER_PORT}`

async function getMainViewUrl(): Promise<string> {
	try {
		const channel = await Updater.localInfo.channel()
		if (channel === 'dev') {
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
	} catch (err) {
		const log = createLogger({ context: 'startup' })
		log.set({ event: 'channel_detection_failed', error: err instanceof Error ? err.message : String(err) })
		log.emit()
		console.error('Failed to detect update channel:', err)
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
				const stackUrl = getStackUrl()
				const contentUrl = `${stackUrl}/content/${path}`
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
// Application menu
// ============================================================================

ApplicationMenu.setApplicationMenu([
	{
		label: '1Sat',
		submenu: [
			{ label: 'About 1Sat', role: 'hide' },
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
		shutdownChatManager()
		closeMcpClient()
		stopMcpServer()
		stopStack()
		flushLogs().finally(() => Utils.quit())
		return
	}
	if (e.data.action === 'toggle-devtools') {
		mainWindow.webview.toggleDevTools()
	}
	if (e.data.action === 'toggle-sync-log') {
		mainWindow.webview.rpc.send.toggleSyncLog({})
	}
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

// Push incoming chat messages to the WebView
setChatMessageCallback((msg) => {
	mainWindow.webview.rpc.send.chatMessageReceived(msg)
})

// Check vault on launch — triggers setStatusChangedCallback which pushes to WebView.
// Also send the initial state once the webview DOM is ready.
const hasKey = checkVault()
mainWindow.webview.on('dom-ready', () => {
	const log = createLogger({ context: 'startup' })
	log.set({ event: 'dom_ready', url, hasKey })
	log.emit()
	mainWindow.webview.rpc.send.walletStateChanged({
		status: hasKey ? 'locked' : 'no-wallet',
	})
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

// Start the 1sat-stack sidecar (local indexer + ORDFS server).
// Errors are non-fatal: the wallet continues if the binary is unavailable.
startStack().then(async () => {
	// Poll until the stack health endpoint responds (up to 30 seconds)
	for (let i = 0; i < 15; i++) {
		await Bun.sleep(2000)
		try {
			const res = await fetch(`${getStackUrl()}/1sat/health`, { signal: AbortSignal.timeout(1000) })
			if (res.ok) break
		} catch {
			// Stack still starting
		}
	}

	const ready = await isStackSetupComplete()
	if (!ready) {
		const log = createLogger({ context: 'stack' })
		log.set({ event: 'onboarding_required', adminUrl: `${getStackUrl()}/1sat/admin` })
		log.emit()
		mainWindow.webview.rpc.send.stackOnboardingRequired({
			adminUrl: `${getStackUrl()}/1sat/admin`,
		})

		// Keep polling until setup completes (user finishes the wizard)
		for (let attempt = 0; attempt < 300; attempt++) {
			await Bun.sleep(3000)
			if (await isStackSetupComplete()) {
				const log = createLogger({ context: 'stack' })
				log.set({ event: 'onboarding_complete' })
				log.emit()
				mainWindow.webview.rpc.send.stackOnboardingComplete({})
				break
			}
		}
	} else {
		const log = createLogger({ context: 'stack' })
		log.set({ event: 'setup_complete' })
		log.emit()
	}
}).catch((err) => {
	const log = createLogger({ context: 'stack' })
	log.set({ event: 'start_failed', error: err instanceof Error ? err.message : String(err) })
	log.emit()
	console.error('1sat-stack failed to start:', err.message)
})

// ============================================================================
// 1sat:// deep link handler + ORDFS content viewer
// ============================================================================

function openOrdfsWindow(path: string): void {
	const stackUrl = getStackUrl()
	const contentUrl = `${stackUrl}/content/${path}`
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
