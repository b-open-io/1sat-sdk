/**
 * 1Sat Wallet — Bun process entry point.
 *
 * Creates the desktop window, wires RPC handlers, sets up the
 * application menu, and boots the wallet lifecycle.
 */
import {
	ApplicationMenu,
	BrowserView,
	BrowserWindow,
	Electrobun,
	Utils,
	Updater,
} from 'electrobun/bun'
import type { WalletDesktopRPC } from '../shared/types'
import { startWalletServer } from './http-server'
import { createRpcHandlers } from './rpc-handlers'
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
	handlers: {
		requests: handlers,
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
	frame: { width: 1024, height: 700, x: 200, y: 200 },
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
			{ label: 'Quit', role: 'quit' },
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
// Window close → hide (keep running in background)
// ============================================================================

mainWindow.on('close', (e) => {
	// Hide instead of closing — the wallet stays running for dApp connections
	mainWindow.minimize()
})

// ============================================================================
// Graceful quit
// ============================================================================

Electrobun.events.on('before-quit', async () => {
	// Lock the wallet before quitting to clear keys from memory
	const { lock } = await import('./wallet-manager')
	await lock()
})

// ============================================================================
// BRC-100 HTTP server for dApp connectivity
// ============================================================================

startWalletServer()

console.log('1Sat Wallet started')
