import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import type { WebviewTagElement } from 'electrobun/view'
import {
	ArrowLeft,
	ArrowRight,
	ExternalLink,
	Globe,
	Plus,
	RotateCw,
	Server,
	X,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { onStackOnboardingRequired, rpc } from '../../rpc'

// ORDFS resolution -- routes on-chain content through the local 1sat-stack sidecar
const STACK_URL = 'http://127.0.0.1:8080'
const OUTPOINT_RE = /^[0-9a-fA-F]{64}[_.]?\d*$/

function resolveUrl(input: string): string {
	const trimmed = input.trim()
	if (!trimmed) return ''

	// 1sat:// deep links -> resolve through local ORDFS
	if (trimmed.startsWith('1sat://')) {
		const path = trimmed.slice('1sat://'.length)
		return `${STACK_URL}/content/${path}`
	}

	// ordfs:// scheme -> local ORDFS
	if (trimmed.startsWith('ordfs://')) {
		const path = trimmed.slice('ordfs://'.length)
		return `${STACK_URL}/content/${path}`
	}

	// Bare outpoint (64-hex txid with optional _vout) -> ORDFS content
	if (OUTPOINT_RE.test(trimmed)) {
		const outpoint = trimmed.includes('_') ? trimmed : `${trimmed}_0`
		return `${STACK_URL}/content/${outpoint}`
	}

	// Already has a scheme
	if (/^[a-zA-Z][a-zA-Z0-9+\-.]*:\/\//.test(trimmed)) return trimmed

	// Looks like a hostname (has a dot, no spaces)
	if (!trimmed.includes(' ') && trimmed.includes('.')) {
		return `https://${trimmed}`
	}

	// Fall through to DuckDuckGo search
	return `https://duckduckgo.com/?q=${encodeURIComponent(trimmed)}`
}

interface BrowserTab {
	id: string
	url: string
	title: string
}

const QUICK_LINKS = [
	{ label: '1Sat Stack Admin', url: `${STACK_URL}/1sat/admin`, icon: Server },
	{ label: '1SatOrdinals.com', url: 'https://1satordinals.com', icon: Globe },
	{ label: 'WhatsOnChain', url: 'https://whatsonchain.com', icon: Globe },
]

let tabIdCounter = 0
function nextTabId(): string {
	return `tab-${++tabIdCounter}-${Date.now()}`
}

export function BrowserView() {
	const [tabs, setTabs] = useState<BrowserTab[]>([])
	const [activeTabId, setActiveTabId] = useState<string | null>(null)
	const [urlInput, setUrlInput] = useState('')
	const [onboardingUrl, setOnboardingUrl] = useState<string | null>(null)

	const containerRef = useRef<HTMLDivElement>(null)
	const webviewsRef = useRef<Map<string, WebviewTagElement>>(new Map())

	// Listen for stack onboarding messages
	useEffect(() => {
		return onStackOnboardingRequired(({ adminUrl }) => {
			setOnboardingUrl(adminUrl)
		})
	}, [])

	// Sync URL bar when active tab changes
	const activeTab = tabs.find((t) => t.id === activeTabId)
	useEffect(() => {
		if (activeTab) {
			setUrlInput(activeTab.url)
		}
	}, [activeTab])

	// Toggle visibility of webviews based on active tab
	useEffect(() => {
		for (const [id, webview] of webviewsRef.current) {
			if (id === activeTabId) {
				webview.style.display = 'block'
				webview.toggleHidden(false)
				webview.togglePassthrough(false)
			} else {
				webview.style.display = 'none'
				webview.toggleHidden(true)
				webview.togglePassthrough(true)
			}
		}
	}, [activeTabId])

	const createWebview = useCallback((tabId: string, url: string) => {
		const container = containerRef.current
		if (!container) return

		const webview = document.createElement('electrobun-webview')
		webview.setAttribute('src', url)
		webview.setAttribute('id', `webview-${tabId}`)
		webview.style.cssText =
			'position: absolute; inset: 0; width: 100%; height: 100%;'

		// Listen for navigation events to update URL bar
		webview.addEventListener('did-navigate', ((e: CustomEvent) => {
			const newUrl = e.detail?.url
			if (newUrl) {
				setTabs((prev) =>
					prev.map((t) => (t.id === tabId ? { ...t, url: newUrl } : t)),
				)
			}
		}) as EventListener)

		webview.addEventListener('did-navigate-in-page', ((e: CustomEvent) => {
			const newUrl = e.detail?.url
			if (newUrl) {
				setTabs((prev) =>
					prev.map((t) => (t.id === tabId ? { ...t, url: newUrl } : t)),
				)
			}
		}) as EventListener)

		// Listen for title changes
		webview.addEventListener('page-title-updated', ((e: CustomEvent) => {
			const title = e.detail?.title
			if (title) {
				setTabs((prev) =>
					prev.map((t) => (t.id === tabId ? { ...t, title } : t)),
				)
			}
		}) as EventListener)

		container.appendChild(webview)
		webviewsRef.current.set(tabId, webview)
	}, [])

	const createTab = useCallback(
		(url?: string) => {
			const id = nextTabId()
			const resolvedUrl = url ? resolveUrl(url) : ''
			const tab: BrowserTab = {
				id,
				url: resolvedUrl,
				title: url ? 'Loading...' : 'New Tab',
			}

			setTabs((prev) => [...prev, tab])
			setActiveTabId(id)

			if (resolvedUrl) {
				// Defer DOM manipulation to after React render
				requestAnimationFrame(() => {
					createWebview(id, resolvedUrl)
				})
			}

			return id
		},
		[createWebview],
	)

	const closeTab = useCallback(
		(tabId: string) => {
			// Remove webview from DOM
			const webview = webviewsRef.current.get(tabId)
			if (webview) {
				webview.remove()
				webviewsRef.current.delete(tabId)
			}

			setTabs((prev) => {
				const next = prev.filter((t) => t.id !== tabId)

				// If we closed the active tab, switch to the last remaining
				if (activeTabId === tabId) {
					const newActive = next.length > 0 ? next[next.length - 1].id : null
					setActiveTabId(newActive)
				}

				return next
			})
		},
		[activeTabId],
	)

	const navigateTo = useCallback(
		(url: string) => {
			const resolved = resolveUrl(url)
			if (!resolved) return

			if (!activeTabId) {
				// No active tab -- create one
				createTab(url)
				return
			}

			// Navigate existing webview
			const webview = webviewsRef.current.get(activeTabId)
			if (webview) {
				webview.src = resolved
			} else {
				// Tab exists but has no webview yet (new tab page)
				createWebview(activeTabId, resolved)
			}

			setTabs((prev) =>
				prev.map((t) =>
					t.id === activeTabId
						? { ...t, url: resolved, title: 'Loading...' }
						: t,
				),
			)
		},
		[activeTabId, createTab, createWebview],
	)

	const handleSubmit = (e: React.FormEvent) => {
		e.preventDefault()
		if (!urlInput.trim()) return
		navigateTo(urlInput)
	}

	const goBack = useCallback(() => {
		if (!activeTabId) return
		const webview = webviewsRef.current.get(activeTabId)
		if (webview) webview.goBack()
	}, [activeTabId])

	const goForward = useCallback(() => {
		if (!activeTabId) return
		const webview = webviewsRef.current.get(activeTabId)
		if (webview) webview.goForward()
	}, [activeTabId])

	const reload = useCallback(() => {
		if (!activeTabId) return
		const webview = webviewsRef.current.get(activeTabId)
		if (webview) webview.reload()
	}, [activeTabId])

	const openExternal = useCallback(() => {
		if (!activeTab) return
		rpc.request.openBrowserWindow({
			url: activeTab.url,
			title: activeTab.title,
		})
	}, [activeTab])

	// Determine if the active tab is showing the new tab page (no webview)
	const showNewTabPage = activeTabId
		? !webviewsRef.current.has(activeTabId)
		: tabs.length === 0

	return (
		<div className="flex flex-col h-full overflow-hidden">
			{/* Stack onboarding banner */}
			{onboardingUrl && (
				<Card className="border-primary/50 bg-primary/5 rounded-none border-x-0 border-t-0 shrink-0">
					<CardContent className="flex items-center justify-between py-3 px-4">
						<div className="flex items-center gap-3">
							<Server size={18} className="text-primary" />
							<div>
								<p className="text-sm font-semibold text-foreground">
									1Sat Stack Setup Required
								</p>
								<p className="text-xs text-muted-foreground">
									Configure JungleBus subscriptions to start syncing
								</p>
							</div>
						</div>
						<Button size="sm" onClick={() => navigateTo(onboardingUrl)}>
							Complete Setup
						</Button>
					</CardContent>
				</Card>
			)}

			{/* Tab bar */}
			<div className="flex items-center gap-1 px-2 h-10 border-b border-border bg-card shrink-0">
				{tabs.map((tab) => (
					<div
						key={tab.id}
						className={`flex items-center gap-1.5 px-3 h-7 rounded-md text-xs cursor-pointer select-none max-w-[200px] group transition-colors ${
							tab.id === activeTabId
								? 'bg-accent text-accent-foreground'
								: 'text-muted-foreground hover:bg-accent/50'
						}`}
						onClick={() => setActiveTabId(tab.id)}
						onKeyDown={(e) => {
							if (e.key === 'Enter' || e.key === ' ') setActiveTabId(tab.id)
						}}
						role="tab"
						tabIndex={0}
						aria-selected={tab.id === activeTabId}
					>
						<Globe size={12} className="shrink-0" />
						<span className="truncate flex-1">{tab.title || 'New Tab'}</span>
						<button
							type="button"
							className="shrink-0 opacity-0 group-hover:opacity-100 hover:text-foreground transition-opacity"
							onClick={(e) => {
								e.stopPropagation()
								closeTab(tab.id)
							}}
						>
							<X size={12} />
						</button>
					</div>
				))}
				<Button
					variant="ghost"
					size="icon"
					className="h-7 w-7 shrink-0"
					onClick={() => createTab()}
				>
					<Plus size={14} />
				</Button>
			</div>

			{/* Navigation bar */}
			<div className="flex items-center gap-2 px-3 h-10 border-b border-border shrink-0">
				<Button
					variant="ghost"
					size="icon"
					className="h-7 w-7 shrink-0"
					onClick={goBack}
					disabled={!activeTabId}
				>
					<ArrowLeft size={16} />
				</Button>
				<Button
					variant="ghost"
					size="icon"
					className="h-7 w-7 shrink-0"
					onClick={goForward}
					disabled={!activeTabId}
				>
					<ArrowRight size={16} />
				</Button>
				<Button
					variant="ghost"
					size="icon"
					className="h-7 w-7 shrink-0"
					onClick={reload}
					disabled={!activeTabId}
				>
					<RotateCw size={16} />
				</Button>
				<form onSubmit={handleSubmit} className="flex-1 flex">
					<Input
						value={urlInput}
						onChange={(e) => setUrlInput(e.target.value)}
						placeholder="Enter URL, outpoint, 1sat://, or search..."
						className="h-7 text-xs"
					/>
				</form>
				<Button
					variant="ghost"
					size="icon"
					className="h-7 w-7 shrink-0"
					onClick={openExternal}
					disabled={!activeTab?.url}
				>
					<ExternalLink size={16} />
				</Button>
			</div>

			{/* Content area */}
			<div className="flex-1 relative overflow-hidden">
				{/* Webview container -- webviews are appended here imperatively */}
				<div ref={containerRef} className="absolute inset-0" />

				{/* New tab page / empty state */}
				{showNewTabPage && (
					<div className="absolute inset-0 flex flex-col items-center justify-center gap-8 bg-background">
						<div className="text-center">
							<h2 className="text-lg font-semibold text-foreground mb-1">
								1Sat Browser
							</h2>
							<p className="text-sm text-muted-foreground">
								Browse on-chain content, ordinals, and the web
							</p>
						</div>
						<div className="grid grid-cols-1 sm:grid-cols-3 gap-3 w-full max-w-lg px-6">
							{QUICK_LINKS.map((link) => (
								<Button
									key={link.url}
									variant="outline"
									className="justify-start gap-2 h-auto py-3"
									onClick={() => navigateTo(link.url)}
								>
									<link.icon
										size={16}
										className="text-muted-foreground shrink-0"
									/>
									<span className="truncate text-xs">{link.label}</span>
								</Button>
							))}
						</div>
					</div>
				)}
			</div>
		</div>
	)
}
