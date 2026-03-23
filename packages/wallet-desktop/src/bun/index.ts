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
import {
	resolvePermission,
	setPermissionPusher,
	startWalletServer,
} from './http-server'
import { createRpcHandlers } from './rpc-handlers'
import {
	checkVault,
	setBalanceUpdatedCallback,
	setStatusChangedCallback,
	setSyncEventCallback,
} from './wallet-manager'
import { startStack, stopStack } from './sidecar-manager'
import { setChatMessageCallback, shutdownChatManager } from './chat-manager'

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

// Check vault on launch — triggers setStatusChangedCallback which pushes to WebView.
// Also send the initial state once the webview DOM is ready.
const hasKey = checkVault()
mainWindow.webview.on('dom-ready', () => {
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
	mainWindow.webview.rpc.send.permissionRequest(request)
})

startWalletServer()

// Start the 1sat-stack sidecar (local indexer + ORDFS server).
// Errors are non-fatal: the wallet continues if the binary is unavailable.
startStack().catch((err) => {
	console.error('1sat-stack failed to start:', err.message)
})

console.log('1Sat Wallet started')
