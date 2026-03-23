import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ArrowLeft, ArrowRight, Globe, Plus, RotateCw, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { cn } from '../../lib/utils'

interface BrowserTab {
	id: string
	url: string
	title: string
	isLoading: boolean
}

interface WebviewElement extends HTMLElement {
	goBack(): void
	goForward(): void
	reload(): void
	loadURL(url: string): void
	canGoBack(): boolean
	canGoForward(): boolean
	on(event: string, handler: (e: CustomEvent) => void): void
	off(event: string, handler: (e: CustomEvent) => void): void
}

function newTab(url = ''): BrowserTab {
	return {
		id: crypto.randomUUID(),
		url,
		title: url ? url : 'New Tab',
		isLoading: false,
	}
}

// Normalizes user input into a navigable URL. Bare terms become searches.
function resolveUrl(input: string): string {
	const trimmed = input.trim()
	if (!trimmed) return ''
	// Already has a scheme
	if (/^[a-zA-Z][a-zA-Z0-9+\-.]*:\/\//.test(trimmed)) return trimmed
	// Looks like a hostname (has a dot, no spaces)
	if (!trimmed.includes(' ') && trimmed.includes('.')) {
		return `https://${trimmed}`
	}
	// Fall through to DuckDuckGo search
	return `https://duckduckgo.com/?q=${encodeURIComponent(trimmed)}`
}

// ---- WebviewHost ----
// Manages a single electrobun-webview DOM element for one tab.
// Hidden when not active; removed on unmount.

interface WebviewHostProps {
	tab: BrowserTab
	isActive: boolean
	onNavigate: (tabId: string, url: string, title: string) => void
	onLoadingChange: (tabId: string, loading: boolean) => void
	onNewWindow: (url: string) => void
	webviewRefs: React.MutableRefObject<Map<string, WebviewElement>>
}

function WebviewHost({
	tab,
	isActive,
	onNavigate,
	onLoadingChange,
	onNewWindow,
	webviewRefs,
}: WebviewHostProps) {
	const containerRef = useRef<HTMLDivElement>(null)

	useEffect(() => {
		const container = containerRef.current
		if (!container) return

		const el = document.createElement('electrobun-webview') as WebviewElement
		el.style.width = '100%'
		el.style.height = '100%'
		el.style.display = 'flex'

		if (tab.url) {
			el.setAttribute('src', tab.url)
		}
		el.setAttribute('preload', 'views://cwi-preload/index.js')
		el.setAttribute('partition', 'persist:browser')

		container.appendChild(el)
		webviewRefs.current.set(tab.id, el)

		const handleNavigate = (e: CustomEvent) => {
			const url = typeof e.detail === 'string' ? e.detail : (e.detail as { url?: string })?.url ?? ''
			onNavigate(tab.id, url, url)
		}

		const handleCommit = (e: CustomEvent) => {
			const url = typeof e.detail === 'string' ? e.detail : (e.detail as { url?: string })?.url ?? ''
			if (url) onNavigate(tab.id, url, url)
		}

		const handleDomReady = () => {
			onLoadingChange(tab.id, false)
		}

		const handleNewWindow = (e: CustomEvent) => {
			const url = typeof e.detail === 'string' ? e.detail : (e.detail as { url?: string })?.url ?? ''
			if (url) onNewWindow(url)
		}

		el.on('did-navigate', handleNavigate)
		el.on('did-navigate-in-page', handleCommit)
		el.on('dom-ready', handleDomReady)
		el.on('new-window-open', handleNewWindow)

		return () => {
			el.off('did-navigate', handleNavigate)
			el.off('did-navigate-in-page', handleCommit)
			el.off('dom-ready', handleDomReady)
			el.off('new-window-open', handleNewWindow)
			webviewRefs.current.delete(tab.id)
			el.remove()
		}
		// Only run on mount — tab.id and tab.url are stable for the lifetime of this component
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [tab.id])

	return (
		<div
			ref={containerRef}
			className={cn('absolute inset-0', !isActive && 'hidden')}
			aria-hidden={!isActive}
		/>
	)
}

// ---- NewTabPage ----

interface NewTabPageProps {
	onNavigate: (url: string) => void
}

function NewTabPage({ onNavigate }: NewTabPageProps) {
	const [query, setQuery] = useState('')

	function handleSubmit(e: React.FormEvent) {
		e.preventDefault()
		const url = resolveUrl(query)
		if (url) onNavigate(url)
	}

	return (
		<div className="flex flex-col items-center justify-center h-full gap-6 bg-background">
			<Globe size={48} className="text-muted-foreground" />
			<p className="text-lg font-semibold text-foreground">New Tab</p>
			<form onSubmit={handleSubmit} className="flex gap-2 w-full max-w-md px-4">
				<Input
					autoFocus
					value={query}
					onChange={(e) => setQuery(e.target.value)}
					placeholder="Search or enter URL…"
					className="flex-1"
				/>
				<Button type="submit" variant="secondary">
					Go
				</Button>
			</form>
		</div>
	)
}

// ---- BrowserView ----

export function BrowserView() {
	const [tabs, setTabs] = useState<BrowserTab[]>(() => [newTab()])
	const [activeTabId, setActiveTabId] = useState<string>(() => tabs[0].id)
	const [urlBarValue, setUrlBarValue] = useState('')
	const webviewRefs = useRef<Map<string, WebviewElement>>(new Map())

	const activeTab = tabs.find((t) => t.id === activeTabId) ?? tabs[0]

	// Keep URL bar in sync with active tab
	useEffect(() => {
		setUrlBarValue(activeTab?.url ?? '')
	}, [activeTab?.url, activeTabId])

	const handleNavigate = useCallback(
		(tabId: string, url: string, title: string) => {
			setTabs((prev) =>
				prev.map((t) =>
					t.id === tabId ? { ...t, url, title: title || url, isLoading: false } : t,
				),
			)
		},
		[],
	)

	const handleLoadingChange = useCallback((tabId: string, loading: boolean) => {
		setTabs((prev) =>
			prev.map((t) => (t.id === tabId ? { ...t, isLoading: loading } : t)),
		)
	}, [])

	const openNewTab = useCallback((url = '') => {
		const tab = newTab(url)
		setTabs((prev) => [...prev, tab])
		setActiveTabId(tab.id)
	}, [])

	const handleNewWindow = useCallback(
		(url: string) => {
			openNewTab(url)
		},
		[openNewTab],
	)

	const closeTab = useCallback(
		(tabId: string, e: React.MouseEvent) => {
			e.stopPropagation()
			setTabs((prev) => {
				const remaining = prev.filter((t) => t.id !== tabId)
				if (remaining.length === 0) {
					const fresh = newTab()
					setActiveTabId(fresh.id)
					return [fresh]
				}
				if (tabId === activeTabId) {
					// Activate the tab to the left, or the first one
					const idx = prev.findIndex((t) => t.id === tabId)
					const next = remaining[Math.max(0, idx - 1)]
					setActiveTabId(next.id)
				}
				return remaining
			})
		},
		[activeTabId],
	)

	function navigateActiveTab(rawUrl: string) {
		const url = resolveUrl(rawUrl)
		if (!url) return
		const el = webviewRefs.current.get(activeTabId)
		if (el) {
			el.loadURL(url)
			setTabs((prev) =>
				prev.map((t) =>
					t.id === activeTabId ? { ...t, url, isLoading: true } : t,
				),
			)
		} else {
			// Tab has no webview yet (blank tab) — update url so the host mounts with it
			setTabs((prev) =>
				prev.map((t) =>
					t.id === activeTabId ? { ...t, url, title: url } : t,
				),
			)
		}
	}

	function handleUrlSubmit(e: React.FormEvent) {
		e.preventDefault()
		navigateActiveTab(urlBarValue)
	}

	function handleBack() {
		webviewRefs.current.get(activeTabId)?.goBack()
	}

	function handleForward() {
		webviewRefs.current.get(activeTabId)?.goForward()
	}

	function handleReload() {
		webviewRefs.current.get(activeTabId)?.reload()
	}

	const activeTabIsBlank = !activeTab?.url

	return (
		<div className="flex flex-col h-full bg-background overflow-hidden">
			{/* Tab strip */}
			<div className="flex-none flex items-center gap-1 border-b border-border bg-card px-2 pt-1 overflow-x-auto min-h-[40px]">
				{tabs.map((tab) => (
					<button
						key={tab.id}
						type="button"
						onClick={() => setActiveTabId(tab.id)}
						className={cn(
							'group flex items-center gap-1.5 h-8 px-3 rounded-t-md text-xs font-medium shrink-0 max-w-[180px] transition-colors',
							tab.id === activeTabId
								? 'bg-background text-foreground border border-b-0 border-border -mb-px'
								: 'text-muted-foreground hover:bg-accent hover:text-foreground',
						)}
					>
						{tab.isLoading ? (
							<RotateCw size={12} className="animate-spin shrink-0 text-muted-foreground" />
						) : (
							<Globe size={12} className="shrink-0 text-muted-foreground" />
						)}
						<span className="truncate max-w-[120px]">{tab.title}</span>
						<span
							role="button"
							tabIndex={0}
							onKeyDown={(e) => {
								if (e.key === 'Enter' || e.key === ' ') closeTab(tab.id, e as unknown as React.MouseEvent)
							}}
							onClick={(e) => closeTab(tab.id, e)}
							className="ml-auto opacity-0 group-hover:opacity-100 hover:text-foreground rounded transition-opacity p-0.5"
							aria-label={`Close ${tab.title}`}
						>
							<X size={10} />
						</span>
					</button>
				))}
				<Button
					variant="ghost"
					size="icon"
					className="h-7 w-7 shrink-0 text-muted-foreground hover:text-foreground"
					onClick={() => openNewTab()}
					aria-label="Open new tab"
				>
					<Plus size={14} />
				</Button>
			</div>

			{/* URL bar */}
			<div className="flex-none flex items-center gap-1 px-2 py-1.5 border-b border-border bg-card">
				<Button
					variant="ghost"
					size="icon"
					className="h-7 w-7 text-muted-foreground hover:text-foreground"
					onClick={handleBack}
					aria-label="Go back"
				>
					<ArrowLeft size={14} />
				</Button>
				<Button
					variant="ghost"
					size="icon"
					className="h-7 w-7 text-muted-foreground hover:text-foreground"
					onClick={handleForward}
					aria-label="Go forward"
				>
					<ArrowRight size={14} />
				</Button>
				<Button
					variant="ghost"
					size="icon"
					className="h-7 w-7 text-muted-foreground hover:text-foreground"
					onClick={handleReload}
					aria-label="Reload"
				>
					<RotateCw size={14} />
				</Button>
				<form onSubmit={handleUrlSubmit} className="flex-1 flex">
					<Input
						value={urlBarValue}
						onChange={(e) => setUrlBarValue(e.target.value)}
						onFocus={(e) => e.target.select()}
						placeholder="Search or enter URL…"
						className="h-7 text-xs flex-1"
					/>
				</form>
			</div>

			{/* Content area */}
			<div className="flex-1 relative overflow-hidden">
				{tabs.map((tab) => (
					<WebviewHost
						key={tab.id}
						tab={tab}
						isActive={tab.id === activeTabId}
						onNavigate={handleNavigate}
						onLoadingChange={handleLoadingChange}
						onNewWindow={handleNewWindow}
						webviewRefs={webviewRefs}
					/>
				))}
				{activeTabIsBlank && (
					<div className="absolute inset-0 z-10">
						<NewTabPage onNavigate={navigateActiveTab} />
					</div>
				)}
			</div>
		</div>
	)
}
