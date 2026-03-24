/**
 * 1Sat — Bun process entry point.
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
				console.log(`HMR enabled: Using Vite dev server at ${DEV_SERVER_URL}`)
				return DEV_SERVER_URL
			} catch {
				console.log(
					"Vite dev server not running. Run 'bun run dev:hmr' for HMR support.",
				)
			}
		}
	} catch (err) {
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

const url = await getMainViewUrl()

const mainWindow = new BrowserWindow({
	title: '1Sat',
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
		Utils.quit()
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
		console.log('1sat-stack needs setup — pushing onboarding to WebView')
		mainWindow.webview.rpc.send.stackOnboardingRequired({
			adminUrl: `${getStackUrl()}/1sat/admin`,
		})

		// Keep polling until setup completes (user finishes the wizard)
		for (let attempt = 0; attempt < 300; attempt++) {
			await Bun.sleep(3000)
			if (await isStackSetupComplete()) {
				console.log('1sat-stack setup completed — dismissing onboarding')
				mainWindow.webview.rpc.send.stackOnboardingComplete({})
				break
			}
		}
	} else {
		console.log('1sat-stack setup is complete')
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

// Handle 1sat:// and bap:// deep links from the OS
Electrobun.events.on('open-url', (e) => {
	const url = e.data.url
	console.log(`Deep link received: ${url}`)

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

console.log('1Sat started')
