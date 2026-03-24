/**
 * Browser window pool for MCP tools.
 *
 * Manages Electrobun BrowserWindows that agents can open, navigate,
 * and execute JS in. Each window is tracked by a unique ID.
 *
 * Note: Electrobun's Bun-side BrowserView type is incomplete — several
 * runtime methods (goBack, reload, host-message events) exist but aren't
 * typed. We use `as any` casts where needed, consistent with how
 * src/bun/index.ts handles the same gap.
 */
import { BrowserWindow } from 'electrobun/bun'

// ---------------------------------------------------------------------------
// URL resolution (ported from src/mainview/views/browser/index.tsx)
// ---------------------------------------------------------------------------

const STACK_URL = 'http://127.0.0.1:8080'
const OUTPOINT_RE = /^[0-9a-fA-F]{64}[_.]?\d*$/

export function resolveUrl(input: string): string {
	const trimmed = input.trim()
	if (!trimmed) return ''

	if (trimmed.startsWith('1sat://')) {
		const body = trimmed.slice(7)
		if (!body) return ''
		const slashIdx = body.indexOf('/')
		const authority = slashIdx === -1 ? body : body.slice(0, slashIdx)
		const path = slashIdx === -1 ? '' : body.slice(slashIdx)
		return `${STACK_URL}/content/${authority}${path}`
	}

	if (trimmed.startsWith('ordfs://')) {
		return `${STACK_URL}/content/${trimmed.slice(8)}`
	}

	if (OUTPOINT_RE.test(trimmed)) {
		const outpoint = trimmed.includes('_') ? trimmed : `${trimmed}_0`
		return `${STACK_URL}/content/${outpoint}`
	}

	if (/^[a-zA-Z][a-zA-Z0-9+\-.]*:\/\//.test(trimmed)) return trimmed

	if (!trimmed.includes(' ') && trimmed.includes('.')) {
		return `https://${trimmed}`
	}

	return `https://duckduckgo.com/?q=${encodeURIComponent(trimmed)}`
}

// ---------------------------------------------------------------------------
// Window pool
// ---------------------------------------------------------------------------

interface ManagedWindow {
	id: string
	window: BrowserWindow
	url: string
	title: string
}

const windows = new Map<string, ManagedWindow>()
let idCounter = 0

// Electrobun's BrowserView type is incomplete — cast to access runtime APIs
// biome-ignore lint/suspicious/noExplicitAny: Electrobun type gap
type WebviewAny = any

export function openWindow(url: string, title?: string): string {
	const id = `mcp-win-${++idCounter}`
	const resolved = resolveUrl(url)
	const win = new BrowserWindow({
		title: title ?? `MCP: ${url.substring(0, 40)}`,
		url: resolved,
		frame: { width: 1200, height: 800, x: 150, y: 100 },
	})

	const managed: ManagedWindow = {
		id,
		window: win,
		url: resolved,
		title: title ?? url,
	}

	const wv = win.webview as WebviewAny

	// Track navigation
	wv.on('did-navigate', (e: unknown) => {
		try {
			const parsed =
				typeof e === 'string'
					? JSON.parse(e)
					: (e as { detail?: string })?.detail
						? JSON.parse((e as { detail: string }).detail)
						: e
			if (parsed?.url) managed.url = parsed.url
			if (parsed?.title) managed.title = parsed.title
		} catch {}
	})

	// Auto-remove on close
	win.on('close', () => {
		windows.delete(id)
	})

	windows.set(id, managed)
	return id
}

export function closeWindow(windowId: string): boolean {
	const managed = windows.get(windowId)
	if (!managed) return false
	managed.window.close()
	windows.delete(windowId)
	return true
}

export function listWindows(): Array<{
	id: string
	url: string
	title: string
}> {
	return Array.from(windows.values()).map((w) => ({
		id: w.id,
		url: w.url,
		title: w.title,
	}))
}

export function navigate(windowId: string, url: string): boolean {
	const managed = windows.get(windowId)
	if (!managed) return false
	const resolved = resolveUrl(url)
	managed.window.webview.loadURL(resolved)
	managed.url = resolved
	return true
}

export function goBack(windowId: string): boolean {
	const managed = windows.get(windowId)
	if (!managed) return false
	// Use executeJavascript since goBack() isn't typed on BrowserView
	managed.window.webview.executeJavascript('window.history.back()')
	return true
}

export function goForward(windowId: string): boolean {
	const managed = windows.get(windowId)
	if (!managed) return false
	managed.window.webview.executeJavascript('window.history.forward()')
	return true
}

export function reload(windowId: string): boolean {
	const managed = windows.get(windowId)
	if (!managed) return false
	managed.window.webview.executeJavascript('window.location.reload()')
	return true
}

/**
 * Execute JS in a browser window and return the result.
 *
 * Uses the __electrobunSendToHost + host-message pattern for return values.
 * The code is wrapped in a self-invoking function; use `return` for the value.
 */
export function executeJs(
	windowId: string,
	code: string,
	timeoutMs = 10_000,
): Promise<string> {
	const managed = windows.get(windowId)
	if (!managed) return Promise.reject(new Error(`Window ${windowId} not found`))

	const callId = crypto.randomUUID()
	const wv = managed.window.webview as WebviewAny

	return new Promise<string>((resolve, reject) => {
		const timer = setTimeout(() => {
			clearTimeout(timer)
			reject(new Error('JS execution timed out'))
		}, timeoutMs)

		const handler = (e: unknown) => {
			try {
				const raw =
					typeof e === 'string' ? e : ((e as { detail?: string })?.detail ?? '')
				const msg = JSON.parse(raw)
				if (msg.type === 'mcp-js-result' && msg.id === callId) {
					clearTimeout(timer)
					if (msg.error) {
						reject(new Error(msg.error))
					} else {
						resolve(msg.result ?? '')
					}
				}
			} catch {
				// Not our message
			}
		}

		wv.on('host-message', handler)
		wv.executeJavascript(`
			try {
				const __r = (() => { ${code} })();
				Promise.resolve(__r).then(__v => {
					const __s = typeof __v === 'string' ? __v : JSON.stringify(__v);
					window.__electrobunSendToHost(JSON.stringify({
						type: 'mcp-js-result', id: '${callId}', result: __s
					}));
				}).catch(__e => {
					window.__electrobunSendToHost(JSON.stringify({
						type: 'mcp-js-result', id: '${callId}', error: __e.message
					}));
				});
			} catch(__e) {
				window.__electrobunSendToHost(JSON.stringify({
					type: 'mcp-js-result', id: '${callId}', error: __e.message
				}));
			}
		`)
	})
}

/**
 * Get the visible text content of a page.
 */
export async function getPageText(windowId: string): Promise<string> {
	return executeJs(windowId, 'return document.body.innerText')
}

/** Close all MCP-managed windows. */
export function closeAll(): void {
	for (const [id] of windows) {
		closeWindow(id)
	}
}
