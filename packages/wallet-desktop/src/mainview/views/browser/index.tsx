import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
	ExternalLink,
	Globe,
	Server,
	Trash2,
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { onStackOnboardingRequired } from '../../rpc'
import { rpc } from '../../rpc'

// ORDFS resolution — routes on-chain content through the local 1sat-stack sidecar
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

interface HistoryEntry {
	url: string
	title: string
	timestamp: number
}

const HISTORY_KEY = '1sat-browser-history'
const MAX_HISTORY = 50

function loadHistory(): HistoryEntry[] {
	try {
		const raw = localStorage.getItem(HISTORY_KEY)
		if (raw) return JSON.parse(raw) as HistoryEntry[]
	} catch {}
	return []
}

function saveHistory(entries: HistoryEntry[]): void {
	localStorage.setItem(HISTORY_KEY, JSON.stringify(entries.slice(0, MAX_HISTORY)))
}

const QUICK_LINKS = [
	{ label: '1Sat Stack Admin', url: `${STACK_URL}/1sat/admin`, icon: Server },
	{ label: '1SatOrdinals.com', url: 'https://1satordinals.com', icon: Globe },
	{ label: 'WhatsOnChain', url: 'https://whatsonchain.com', icon: Globe },
]

export function BrowserView() {
	const [urlInput, setUrlInput] = useState('')
	const [history, setHistory] = useState<HistoryEntry[]>(loadHistory)
	const [onboardingUrl, setOnboardingUrl] = useState<string | null>(null)

	// Listen for stack onboarding messages
	useEffect(() => {
		return onStackOnboardingRequired(({ adminUrl }) => {
			setOnboardingUrl(adminUrl)
		})
	}, [])

	const openUrl = useCallback(
		(url: string, title?: string) => {
			rpc.request.openBrowserWindow({ url, title })

			const entry: HistoryEntry = {
				url,
				title: title ?? url,
				timestamp: Date.now(),
			}
			setHistory((prev) => {
				const next = [entry, ...prev.filter((h) => h.url !== url)].slice(
					0,
					MAX_HISTORY,
				)
				saveHistory(next)
				return next
			})
		},
		[],
	)

	function handleSubmit(e: React.FormEvent) {
		e.preventDefault()
		const resolved = resolveUrl(urlInput)
		if (!resolved) return
		openUrl(resolved, urlInput)
		setUrlInput('')
	}

	function clearHistory() {
		setHistory([])
		localStorage.removeItem(HISTORY_KEY)
	}

	return (
		<div className="flex flex-col h-full overflow-y-auto p-6 gap-6">
			{/* Stack onboarding banner */}
			{onboardingUrl && (
				<Card className="border-primary/50 bg-primary/5">
					<CardContent className="flex items-center justify-between py-4">
						<div className="flex items-center gap-3">
							<Server size={20} className="text-primary" />
							<div>
								<p className="text-sm font-semibold text-foreground">
									1Sat Stack Setup Required
								</p>
								<p className="text-xs text-muted-foreground">
									Configure JungleBus subscriptions to start syncing
								</p>
							</div>
						</div>
						<Button
							size="sm"
							onClick={() => openUrl(onboardingUrl, '1Sat Stack Setup')}
						>
							Complete Setup
						</Button>
					</CardContent>
				</Card>
			)}

			{/* URL input */}
			<Card>
				<CardHeader>
					<CardTitle className="text-sm flex items-center gap-2">
						<Globe size={16} />
						Open in New Window
					</CardTitle>
				</CardHeader>
				<CardContent>
					<form onSubmit={handleSubmit} className="flex gap-2">
						<Input
							autoFocus
							value={urlInput}
							onChange={(e) => setUrlInput(e.target.value)}
							placeholder="Enter URL, outpoint, 1sat://, or search..."
							className="flex-1"
						/>
						<Button type="submit">Open</Button>
					</form>
					<div className="flex flex-wrap gap-1.5 mt-3">
						<Badge variant="secondary" className="text-[10px]">
							1sat://
						</Badge>
						<Badge variant="secondary" className="text-[10px]">
							ordfs://
						</Badge>
						<Badge variant="secondary" className="text-[10px]">
							txid_vout
						</Badge>
						<Badge variant="secondary" className="text-[10px]">
							https://
						</Badge>
					</div>
				</CardContent>
			</Card>

			{/* Quick links */}
			<Card>
				<CardHeader>
					<CardTitle className="text-sm">Quick Links</CardTitle>
				</CardHeader>
				<CardContent>
					<div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
						{QUICK_LINKS.map((link) => (
							<Button
								key={link.url}
								variant="outline"
								className="justify-start gap-2 h-auto py-2.5"
								onClick={() => openUrl(link.url, link.label)}
							>
								<link.icon size={14} className="text-muted-foreground shrink-0" />
								<span className="truncate text-xs">{link.label}</span>
								<ExternalLink
									size={10}
									className="ml-auto text-muted-foreground shrink-0"
								/>
							</Button>
						))}
					</div>
				</CardContent>
			</Card>

			{/* History */}
			{history.length > 0 && (
				<Card>
					<CardHeader>
						<div className="flex items-center justify-between">
							<CardTitle className="text-sm">Recently Opened</CardTitle>
							<Button
								variant="ghost"
								size="sm"
								className="h-7 text-xs text-muted-foreground"
								onClick={clearHistory}
							>
								<Trash2 size={12} className="mr-1" />
								Clear
							</Button>
						</div>
					</CardHeader>
					<CardContent>
						<div className="space-y-1">
							{history.map((entry) => (
								<button
									key={`${entry.url}-${entry.timestamp}`}
									type="button"
									className="w-full flex items-center gap-3 px-3 py-2 rounded-md text-left hover:bg-accent transition-colors"
									onClick={() => openUrl(entry.url, entry.title)}
								>
									<Globe size={14} className="text-muted-foreground shrink-0" />
									<div className="flex-1 min-w-0">
										<p className="text-xs font-medium text-foreground truncate">
											{entry.title}
										</p>
										<p className="text-[10px] text-muted-foreground truncate">
											{entry.url}
										</p>
									</div>
									<span className="text-[10px] text-muted-foreground shrink-0">
										{new Date(entry.timestamp).toLocaleTimeString([], {
											hour: '2-digit',
											minute: '2-digit',
										})}
									</span>
									<ExternalLink
										size={10}
										className="text-muted-foreground shrink-0"
									/>
								</button>
							))}
						</div>
					</CardContent>
				</Card>
			)}
		</div>
	)
}
