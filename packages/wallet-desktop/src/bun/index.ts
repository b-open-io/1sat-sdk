/**
 * 1Sat Wallet — Bun process entry point.
 *
 * Creates the desktop window, wires RPC handlers, sets up the
 * application menu, and boots the wallet lifecycle.
 */
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
	const channel = await Updater.localInfo.channel()
	if (channel === 'dev') {
		try {
			await fetch(DEV_SERVER_URL, { method: 'HEAD' })
			console.log(`HMR enabled: Using Vite dev server at ${DEV_SERVER_URL}`)
			return DEV_SERVER_URL
		} catch {
			console.log(
				"Vite dev server not running. Run 'bun run dev:hmr' for HMR support.",
			)
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
			openOrdfsContent: ({ path }: { path: string }) => {
				const stackUrl = getStackUrl()
				const contentUrl = `${stackUrl}/content/${path}`
				console.log(`Opening ORDFS content: ${contentUrl}`)
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
				new BrowserWindow({
					title: title ?? url.substring(0, 40),
					url,
					frame: { width: 1024, height: 700, x: 150, y: 150 },
				})
				return { success: true }
			},
		},
		messages: {},
	},
})

// ============================================================================
// Application window
// ============================================================================

const url = await getMainViewUrl()

const mainWindow = new BrowserWindow({
	title: '1Sat Wallet',
	url,
	frame: { width: 1440, height: 900, x: 100, y: 100 },
	titleBarStyle: 'hiddenInset',
	rpc,
})

// ============================================================================
// Application menu
// ============================================================================

ApplicationMenu.setApplicationMenu([
	{
		label: '1Sat Wallet',
		submenu: [
			{ label: 'About 1Sat Wallet', role: 'hide' },
			{ type: 'separator' },
			{ role: 'hide' },
			{ role: 'hideOthers' },
			{ role: 'showAll' },
			{ type: 'separator' },
			{ label: 'Quit 1Sat Wallet', action: 'quit', accelerator: 'q' },
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
		submenu: [{ role: 'toggleFullScreen' }],
	},
])

// ============================================================================
// Menu actions
// ============================================================================

Electrobun.events.on('application-menu-clicked', (e) => {
	if (e.data.action === 'quit') {
		shutdownChatManager()
		stopStack()
		Utils.quit()
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
	mainWindow.webview.rpc.send.walletStateChanged({
		status: hasKey ? 'locked' : 'no-wallet',
	})

	// Double-click on titlebar area to maximize/unmaximize
	mainWindow.webview.executeJavascript(`
		document.addEventListener('dblclick', function(e) {
			if (e.clientY < 38 && !e.target.closest('button, a, input, select, [role="button"]')) {
				if (window.__electrobunSendToHost) {
					window.__electrobunSendToHost(JSON.stringify({ type: 'titlebar-dblclick' }));
				}
			}
		});
	`)
})

// Handle titlebar double-click to toggle maximize
mainWindow.webview.on('host-message', (e) => {
	try {
		const msg = JSON.parse(e.detail)
		if (msg.type === 'titlebar-dblclick') {
			if (mainWindow.isMaximized()) {
				mainWindow.unmaximize()
			} else {
				mainWindow.maximize()
			}
		}
	} catch {}
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

// Start the 1sat-stack sidecar (local indexer + ORDFS server).
// Errors are non-fatal: the wallet continues if the binary is unavailable.
startStack().then(async () => {
	// Give the stack a moment to initialize
	await Bun.sleep(3000)
	const ready = await isStackSetupComplete()
	if (!ready) {
		mainWindow.webview.rpc.send.stackOnboardingRequired({
			adminUrl: `${getStackUrl()}`,
		})
	}
}).catch((err) => {
	console.error('1sat-stack failed to start:', err.message)
})

// ============================================================================
// 1sat:// deep link handler + ORDFS content viewer
// ============================================================================

function openOrdfsWindow(path: string): void {
	const stackUrl = getStackUrl()
	const contentUrl = `${stackUrl}/content/${path}`
	console.log(`Opening ORDFS content: ${contentUrl}`)

	new BrowserWindow({
		title: `1Sat: ${path.substring(0, 16)}...`,
		url: contentUrl,
		frame: { width: 900, height: 700, x: 150, y: 150 },
	})
}

// Handle 1sat:// deep links from the OS (registered via urlSchemes in config)
Electrobun.events.on('open-url', (e) => {
	const url = e.data.url
	console.log(`Deep link received: ${url}`)

	if (url.startsWith('1sat://')) {
		const path = url.slice('1sat://'.length)
		if (path) openOrdfsWindow(path)
	}
})

console.log('1Sat Wallet started')
