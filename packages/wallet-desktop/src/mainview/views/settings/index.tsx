import {
	type ScanResult,
	type SweepResult,
	SweepWallet,
} from '@/components/blocks/sweep-wallet'
import {
	ThemeTokenProvider,
	ThemeTokenSettings,
} from '@/components/blocks/theme-token-provider'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Empty } from '@/components/ui/empty'
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
	ExternalLink,
	Globe,
	Info,
	Monitor,
	Moon,
	RefreshCw,
	RotateCcw,
	ShieldCheck,
	Sun,
	Trash2,
} from 'lucide-react'
import { Switch } from 'radix-ui'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
	type AppearanceMode,
	useAppearance,
} from '../../hooks/use-appearance'
import {
	type BrowserSettings,
	type SearchMode,
	STACK_URL as STACK_BASE_URL,
	WALLET_HTTP_PORT,
	WALLET_HTTP_URL,
	WALLET_HTTPS_PORT,
	WALLET_MCP_PORT,
	loadBrowserSettings,
	saveBrowserSettings,
} from '../../../shared/constants'
import { useWallet } from '../../hooks/use-wallet'
import { rpc } from '../../rpc'

// ---------------------------------------------------------------------------
// AI Settings types and helpers
// ---------------------------------------------------------------------------

type AiProvider = 'ollama' | 'lmstudio' | 'openrouter' | 'openai' | 'anthropic'

interface AiSettings {
	provider: AiProvider
	baseUrl: string
	apiKey: string
	model: string
}

const AI_SETTINGS_KEY = '1sat-ai-settings'

const PROVIDER_DEFAULTS: Record<
	AiProvider,
	{ baseUrl: string; label: string }
> = {
	ollama: { baseUrl: 'http://localhost:11434/v1', label: 'Ollama (Local)' },
	lmstudio: { baseUrl: 'http://localhost:1234/v1', label: 'LM Studio (Local)' },
	openrouter: { baseUrl: 'https://openrouter.ai/api/v1', label: 'OpenRouter' },
	openai: { baseUrl: 'https://api.openai.com/v1', label: 'OpenAI' },
	anthropic: { baseUrl: 'https://api.anthropic.com/v1', label: 'Anthropic' },
}

function loadAiSettings(): AiSettings {
	try {
		const raw = localStorage.getItem(AI_SETTINGS_KEY)
		if (raw) return JSON.parse(raw) as AiSettings
	} catch {
		// ignore
	}
	return {
		provider: 'ollama',
		baseUrl: 'http://localhost:11434/v1',
		apiKey: '',
		model: 'qwen3:14b',
	}
}

function saveAiSettings(settings: AiSettings) {
	localStorage.setItem(AI_SETTINGS_KEY, JSON.stringify(settings))
}

// ---------------------------------------------------------------------------
// Stack health types
// ---------------------------------------------------------------------------

interface StackHealth {
	blockHeight: number | null
	uptimeSeconds: number | null
	running: boolean
	syncPercent: number | null
}

async function fetchStackHealth(): Promise<StackHealth> {
	try {
		const res = await fetch(`${STACK_BASE_URL}/1sat/health`, {
			signal: AbortSignal.timeout(4000),
		})
		if (!res.ok)
			return {
				blockHeight: null,
				uptimeSeconds: null,
				running: false,
				syncPercent: null,
			}
		const data = await res.json()
		const rawUptime = data.uptime ?? data.uptimeSeconds ?? null
		const uptimeSeconds = typeof rawUptime === 'number' ? rawUptime : null
		const syncPercent: number | null =
			typeof data.syncPercent === 'number'
				? data.syncPercent
				: typeof data.sync_percent === 'number'
					? data.sync_percent
					: null
		return {
			blockHeight: data.blockHeight ?? data.block_height ?? null,
			uptimeSeconds,
			running: true,
			syncPercent,
		}
	} catch {
		return {
			blockHeight: null,
			uptimeSeconds: null,
			running: false,
			syncPercent: null,
		}
	}
}

function formatUptime(seconds: number): string {
	const h = Math.floor(seconds / 3600)
	const m = Math.floor((seconds % 3600) / 60)
	if (h > 0) return `${h}h ${m}m`
	return `${m}m`
}

// ---------------------------------------------------------------------------
// Stack admin API helpers
// ---------------------------------------------------------------------------

async function stackFetch(path: string, options?: RequestInit) {
	const res = await fetch(`${STACK_BASE_URL}${path}`, {
		...options,
		signal: AbortSignal.timeout(5000),
	})
	if (!res.ok) {
		const body = await res.text().catch(() => '')
		if (body.includes('authentication')) {
			throw new Error('authentication required — open the admin panel to authenticate')
		}
		throw new Error(`Stack API error: ${res.status}`)
	}
	return res.json()
}

interface StackConfig {
	[key: string]: string
}

interface StackProgressEntry {
	id: string
	currentBlock: number | null
	status: string
}

const OVERLAY_KEYS = [
	{ key: 'overlay.bap.enabled', label: 'BAP' },
	{ key: 'overlay.opns.enabled', label: 'OpNS' },
	{ key: 'overlay.bsv21.enabled', label: 'BSV21' },
	{ key: 'overlay.bsocial.enabled', label: 'BSocial' },
	{ key: 'overlay.ordlock.enabled', label: 'OrdLock' },
] as const

// ---------------------------------------------------------------------------
// Connected Apps storage
// ---------------------------------------------------------------------------

const CONNECTED_APPS_KEY = '1sat-connected-apps'
const AUTO_LOCK_KEY = '1sat-auto-lock'

export interface ConnectedApp {
	origin: string
	/** Display label — derived from origin if absent */
	label?: string
	permissions: string[]
	lastAccessMs: number
}

function loadConnectedApps(): ConnectedApp[] {
	try {
		const raw = localStorage.getItem(CONNECTED_APPS_KEY)
		if (raw) return JSON.parse(raw) as ConnectedApp[]
	} catch {
		// ignore
	}
	return []
}

export function saveConnectedApp(app: ConnectedApp) {
	const apps = loadConnectedApps()
	const idx = apps.findIndex((a) => a.origin === app.origin)
	if (idx >= 0) {
		apps[idx] = app
	} else {
		apps.push(app)
	}
	localStorage.setItem(CONNECTED_APPS_KEY, JSON.stringify(apps))
}

function revokeConnectedApp(origin: string) {
	const apps = loadConnectedApps().filter((a) => a.origin !== origin)
	localStorage.setItem(CONNECTED_APPS_KEY, JSON.stringify(apps))
}

function loadAutoLock(): string {
	return localStorage.getItem(AUTO_LOCK_KEY) ?? '15'
}

export function saveAutoLock(value: string) {
	localStorage.setItem(AUTO_LOCK_KEY, value)
}

export function getAutoLockSetting(): string {
	return loadAutoLock()
}

function formatLastAccess(ms: number): string {
	const diffMs = Date.now() - ms
	const diffMin = Math.floor(diffMs / 60_000)
	if (diffMin < 1) return 'Just now'
	if (diffMin < 60) return `${diffMin}m ago`
	const diffH = Math.floor(diffMin / 60)
	if (diffH < 24) return `${diffH}h ago`
	const diffD = Math.floor(diffH / 24)
	return `${diffD}d ago`
}

// ---------------------------------------------------------------------------
// Security Tab
// ---------------------------------------------------------------------------

function SecurityTab() {
	const { deleteWallet } = useWallet()
	const [autoLock, setAutoLock] = useState(loadAutoLock)
	const [connectedApps, setConnectedApps] = useState<ConnectedApp[]>(
		loadConnectedApps,
	)
	const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
	const [deleting, setDeleting] = useState(false)
	const [deleteError, setDeleteError] = useState('')

	const handleAutoLockChange = useCallback((value: string) => {
		setAutoLock(value)
		saveAutoLock(value)
	}, [])

	const handleRevokeApp = useCallback((origin: string) => {
		revokeConnectedApp(origin)
		setConnectedApps((prev) => prev.filter((a) => a.origin !== origin))
	}, [])

	const handleDeleteWallet = useCallback(async () => {
		setDeleting(true)
		setDeleteError('')
		const result = await deleteWallet()
		if (!result.success) {
			setDeleteError(result.error ?? 'Failed to delete wallet')
			setDeleting(false)
			return
		}
		setDeleteDialogOpen(false)
		setDeleting(false)
	}, [deleteWallet])

	return (
		<div className="space-y-6 py-4">
			{/* Vault Status card */}
			<div className="bg-card rounded-xl p-5 flex items-center gap-4">
				<div className="flex items-center justify-center size-13 rounded-xl bg-primary/10 shrink-0">
					<ShieldCheck className="size-6 text-primary" />
				</div>
				<div className="flex-1 min-w-0">
					<p className="text-[15px] font-semibold leading-tight">
						Vault Protected
					</p>
					<p className="text-xs text-muted-foreground mt-0.5">
						Touch ID (Secure Enclave)
					</p>
				</div>
				<span className="flex items-center gap-1.5 text-[11px] font-semibold text-primary bg-primary/10 px-3 py-1 shrink-0">
					<span className="size-1.5 rounded-full bg-primary inline-block" />
					Active
				</span>
			</div>

			{/* Auto-Lock row */}
			<div className="flex items-center justify-between py-1">
				<div>
					<p className="text-sm font-medium">Auto-Lock</p>
					<p className="text-xs text-muted-foreground mt-0.5">
						Lock wallet after inactivity
					</p>
				</div>
				<Select value={autoLock} onValueChange={handleAutoLockChange}>
					<SelectTrigger size="sm" className="w-36 bg-input border-border">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="5">5 minutes</SelectItem>
						<SelectItem value="15">15 minutes</SelectItem>
						<SelectItem value="30">30 minutes</SelectItem>
						<SelectItem value="60">1 hour</SelectItem>
						<SelectItem value="never">Never</SelectItem>
					</SelectContent>
				</Select>
			</div>

			<Separator />

			{/* Connected Apps section */}
			<div>
				<div className="flex items-center justify-between mb-3">
					<p className="text-[10px] uppercase tracking-widest text-muted-foreground">
						Connected Apps
					</p>
					{connectedApps.length > 0 && (
						<span className="text-[11px] font-medium text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
							{connectedApps.length}
						</span>
					)}
				</div>

				{connectedApps.length === 0 ? (
					<Empty
						icon={ShieldCheck}
						title="No connected apps"
						description="Apps you authorize via BRC-100 will appear here."
					/>
				) : (
					<div className="bg-card rounded-xl overflow-hidden divide-y divide-border">
						{connectedApps.map((app) => (
							<div
								key={app.origin}
								className="flex items-center gap-3 px-4 h-[52px]"
							>
								<div className="flex items-center justify-center size-7 rounded-md bg-muted shrink-0">
									<Globe className="size-3.5 text-primary" />
								</div>
								<div className="flex-1 min-w-0">
									<p className="text-[13px] font-medium leading-tight truncate">
										{app.label ??
											app.origin.replace(/^https?:\/\//, '')}
									</p>
									<p className="text-[11px] text-muted-foreground mt-0.5">
										{app.permissions.length} permission
										{app.permissions.length !== 1 ? 's' : ''}
										{' · '}
										{formatLastAccess(app.lastAccessMs)}
									</p>
								</div>
								<button
									type="button"
									onClick={() => handleRevokeApp(app.origin)}
									className="text-[12px] font-medium text-destructive hover:text-destructive/80 transition-colors shrink-0 px-1 py-0.5"
								>
									Revoke
								</button>
							</div>
						))}
					</div>
				)}
			</div>

			<Separator />

			{/* Backup info section */}
			<div>
				<p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-3">
					Backup
				</p>

				<div className="bg-card rounded-xl p-4">
					<div className="flex items-start gap-3">
						<Info className="size-4 text-muted-foreground mt-0.5 shrink-0" />
						<div className="space-y-2">
							<p className="text-sm font-medium">Seed Phrase</p>
							<p className="text-xs text-muted-foreground leading-relaxed">
								Your seed phrase was shown once during wallet creation. The
								wallet stores a derived key protected by Touch ID and the Secure
								Enclave — the seed phrase itself is never stored on this device.
							</p>
							<p className="text-xs text-muted-foreground leading-relaxed">
								If you wrote down your 12 recovery words at creation time, keep
								them stored safely offline. They are the only way to recover your
								wallet on a new device.
							</p>
						</div>
					</div>
				</div>
			</div>

			<Separator />

			{/* Delete Wallet section */}
			<div>
				<p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-3">
					Danger Zone
				</p>

				<div className="flex items-center justify-between py-3">
					<div>
						<p className="text-sm font-medium text-destructive">
							Delete Wallet
						</p>
						<p className="text-xs text-muted-foreground mt-0.5">
							Remove the vault key and all local wallet data from this device
						</p>
					</div>
					<Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
						<DialogTrigger asChild>
							<Button
								variant="ghost"
								size="sm"
								className="text-destructive hover:text-destructive hover:bg-destructive/10"
							>
								<Trash2 className="size-3.5 mr-1.5" />
								Delete
							</Button>
						</DialogTrigger>
						<DialogContent className="sm:max-w-sm">
							<DialogHeader>
								<DialogTitle>Delete Wallet</DialogTitle>
								<DialogDescription>
									This will permanently remove the Secure Enclave key and all
									local wallet data. You will need your seed phrase to recover
									this wallet.
								</DialogDescription>
							</DialogHeader>
							{deleteError && (
								<div className="p-3 border border-destructive/50 bg-destructive/5 text-destructive text-xs font-[family-name:var(--font-mono)] rounded-md">
									{deleteError}
								</div>
							)}
							<DialogFooter>
								<Button
									variant="ghost"
									onClick={() => setDeleteDialogOpen(false)}
									disabled={deleting}
								>
									Cancel
								</Button>
								<Button
									variant="destructive"
									onClick={handleDeleteWallet}
									disabled={deleting}
								>
									{deleting ? 'Deleting...' : 'Permanently Delete'}
								</Button>
							</DialogFooter>
						</DialogContent>
					</Dialog>
				</div>
			</div>
		</div>
	)
}

// ---------------------------------------------------------------------------
// Network Tab
// ---------------------------------------------------------------------------

function NetworkTab({ onNavigate }: { onNavigate?: (url: string) => void }) {
	const [health, setHealth] = useState<StackHealth>({
		blockHeight: null,
		uptimeSeconds: null,
		running: false,
		syncPercent: null,
	})
	const [lastChecked, setLastChecked] = useState<Date | null>(null)
	const [config, setConfig] = useState<StackConfig>({})
	const [progress, setProgress] = useState<StackProgressEntry[]>([])
	const [togglingKey, setTogglingKey] = useState<string | null>(null)
	const [restartDialogOpen, setRestartDialogOpen] = useState(false)
	const [restarting, setRestarting] = useState(false)
	const [restartError, setRestartError] = useState('')
	const [restartRequired, setRestartRequired] = useState(false)
	const isMounted = useRef(true)

	useEffect(() => {
		isMounted.current = true
		return () => {
			isMounted.current = false
		}
	}, [])

	const fetchAdminData = useCallback(async () => {
		try {
			const [cfg, prog] = await Promise.all([
				stackFetch('/1sat/admin/api/config') as Promise<StackConfig>,
				stackFetch('/1sat/admin/api/progress').then((data: unknown) => {
					// Accept both array and object shapes
					if (Array.isArray(data)) return data as StackProgressEntry[]
					if (data && typeof data === 'object') {
						return Object.entries(data as Record<string, unknown>).map(
							([id, val]) => {
								const entry = val as Record<string, unknown>
								return {
									id,
									currentBlock:
										typeof entry.currentBlock === 'number'
											? entry.currentBlock
											: typeof entry.current_block === 'number'
												? entry.current_block
												: null,
									status:
										typeof entry.status === 'string' ? entry.status : 'unknown',
								} satisfies StackProgressEntry
							},
						)
					}
					return []
				}),
			])
			if (isMounted.current) {
				setConfig(cfg)
				setProgress(prog)
			}
		} catch {
			// Stack offline — config/progress remain stale or empty
		}
	}, [])

	const refresh = useCallback(async () => {
		const result = await fetchStackHealth()
		if (isMounted.current) {
			setHealth(result)
			setLastChecked(new Date())
		}
		if (result.running) {
			await fetchAdminData()
		}
	}, [fetchAdminData])

	useEffect(() => {
		refresh()
		const interval = setInterval(refresh, 10_000)
		return () => clearInterval(interval)
	}, [refresh])

	const handleOverlayToggle = useCallback(
		async (key: string, currentValue: boolean) => {
			setTogglingKey(key)
			try {
				await stackFetch('/1sat/admin/api/config', {
					method: 'PUT',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ [key]: String(!currentValue) }),
				})
				setConfig((prev) => ({ ...prev, [key]: String(!currentValue) }))
				setRestartRequired(true)
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err)
				if (msg.includes('authentication')) {
					// Stack admin requires auth — direct user to admin panel
					onNavigate?.(`${STACK_BASE_URL}/1sat/admin/`)
				}
				console.error('Failed to update overlay config:', msg)
			} finally {
				if (isMounted.current) setTogglingKey(null)
			}
		},
		[],
	)

	const handleRestart = useCallback(async () => {
		setRestarting(true)
		setRestartError('')
		try {
			await stackFetch('/1sat/admin/api/restart', { method: 'POST' })
			setRestartRequired(false)
			setRestartDialogOpen(false)
		} catch (err) {
			setRestartError(err instanceof Error ? err.message : 'Restart failed')
		} finally {
			if (isMounted.current) setRestarting(false)
		}
	}, [])

	const uptimeDisplay =
		health.uptimeSeconds !== null ? formatUptime(health.uptimeSeconds) : '—'

	return (
		<div className="space-y-8 py-4">
			{/* Status Section */}
			<div>
				<div className="flex items-center justify-between mb-3">
					<p className="text-[10px] uppercase tracking-widest text-muted-foreground">
						Status
					</p>
					{lastChecked && (
						<p className="text-[10px] text-muted-foreground">
							Updated {lastChecked.toLocaleTimeString()}
						</p>
					)}
				</div>

				{!health.running && (
					<div className="mb-4 p-3 border border-destructive/30 bg-destructive/5 flex items-center gap-3">
						<span className="size-2 rounded-full bg-destructive shrink-0" />
						<p className="text-sm text-destructive font-medium">
							Stack Offline — start the 1sat-stack to enable these features
						</p>
					</div>
				)}

				<div className="grid grid-cols-3 gap-3">
					{/* Status indicator */}
					<div className="bg-card rounded-lg p-4">
						<p className="text-xs text-muted-foreground mb-1">Status</p>
						<div className="flex items-center gap-2 mt-1">
							<span
								className={`size-2.5 rounded-full shrink-0 ${
									health.running ? 'bg-primary' : 'bg-destructive'
								}`}
							/>
							<p
								className={`text-base font-bold ${
									health.running ? 'text-primary' : 'text-destructive'
								}`}
							>
								{health.running ? 'Running' : 'Offline'}
							</p>
						</div>
					</div>

					{/* Block Height */}
					<div className="bg-card rounded-lg p-4">
						<p className="text-xs text-muted-foreground mb-1">Block Height</p>
						<p className="text-xl font-bold font-[family-name:var(--font-mono)]">
							{health.blockHeight !== null
								? health.blockHeight.toLocaleString()
								: '—'}
						</p>
					</div>

					{/* Uptime */}
					<div className="bg-card rounded-lg p-4">
						<p className="text-xs text-muted-foreground mb-1">Uptime</p>
						<p className="text-xl font-bold font-[family-name:var(--font-mono)]">{uptimeDisplay}</p>
					</div>
				</div>
			</div>

			{/* Sync Progress Bar Section */}
			{health.syncPercent !== null && (
				<div className="bg-card rounded-lg p-4 space-y-2.5">
					<div className="flex items-center justify-between">
						<p className="text-sm font-semibold">Sync Progress</p>
						<p className="text-sm font-semibold text-primary font-[family-name:var(--font-mono)]">
							{health.syncPercent.toFixed(1)}%
						</p>
					</div>
					<div className="h-1.5 w-full rounded-full bg-border overflow-hidden">
						<div
							className="h-full rounded-full bg-primary transition-all duration-500"
							style={{ width: `${Math.min(health.syncPercent, 100)}%` }}
						/>
					</div>
					{health.blockHeight !== null && (
						<p className="text-xs text-muted-foreground">
							{health.syncPercent.toFixed(1)}% synced — Block{' '}
							<span className="font-[family-name:var(--font-mono)]">
								{health.blockHeight.toLocaleString()}
							</span>
						</p>
					)}
				</div>
			)}

			{/* Local Services Card */}
			<div>
				<p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-3">
					Local Services
				</p>
				<div className="bg-card rounded-lg divide-y divide-border overflow-hidden">
					{[
						{ label: 'BRC-100 HTTP', port: WALLET_HTTP_PORT },
						{ label: 'BRC-100 HTTPS', port: WALLET_HTTPS_PORT },
						{ label: 'MCP Server', port: WALLET_MCP_PORT },
					].map(({ label, port }) => (
						<div key={port} className="flex items-center gap-3 px-4 h-11">
							<span className="size-2 rounded-full bg-primary shrink-0" />
							<span className="flex-1 text-sm">{label}</span>
							<span className="text-xs text-muted-foreground font-[family-name:var(--font-mono)]">
								:{port}
							</span>
						</div>
					))}
				</div>
			</div>

			{/* Overlay Services Section */}
			<div>
				<div className="flex items-center gap-3 mb-3">
					<p className="text-[10px] uppercase tracking-widest text-muted-foreground">
						Overlay Services
					</p>
					{restartRequired && (
						<Badge
							variant="outline"
							className="text-[10px] text-primary border-primary/40 bg-primary/10 py-0"
						>
							Restart required
						</Badge>
					)}
				</div>

				<div className="bg-card rounded-lg divide-y divide-border overflow-hidden">
					{OVERLAY_KEYS.map(({ key, label }) => {
						const enabled = config[key] === 'true' || config[key] === '1'
						const isToggling = togglingKey === key
						return (
							<div key={key} className="flex items-center gap-3 px-4 py-3">
								<span className="flex-1 text-sm font-medium">{label}</span>
								<span className="text-xs text-muted-foreground font-[family-name:var(--font-mono)] mr-3">
									{key}
								</span>
								<Switch.Root
									checked={enabled}
									disabled={!health.running || isToggling}
									onCheckedChange={() => handleOverlayToggle(key, enabled)}
									className={[
										'relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors',
										'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
										'disabled:cursor-not-allowed disabled:opacity-50',
										enabled ? 'bg-primary' : 'bg-input',
									].join(' ')}
								>
									<Switch.Thumb
										className={[
											'pointer-events-none block size-4 rounded-full bg-white shadow-sm ring-0 transition-transform',
											enabled ? 'translate-x-4' : 'translate-x-0',
										].join(' ')}
									/>
								</Switch.Root>
							</div>
						)
					})}
				</div>
			</div>

			{/* Sync Progress Section */}
			<div>
				<p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-3">
					Sync Progress
				</p>

				{progress.length === 0 ? (
					<div className="bg-card rounded-lg px-4 py-6 text-center">
						<p className="text-sm text-muted-foreground">
							{health.running ? 'No indexers reported' : 'Stack offline'}
						</p>
					</div>
				) : (
					<div className="bg-card rounded-lg overflow-hidden">
						<div className="grid grid-cols-3 px-4 py-2 border-b border-border">
							<p className="text-[10px] uppercase tracking-widest text-muted-foreground">
								Indexer
							</p>
							<p className="text-[10px] uppercase tracking-widest text-muted-foreground text-right">
								Current Block
							</p>
							<p className="text-[10px] uppercase tracking-widest text-muted-foreground text-right">
								Status
							</p>
						</div>
						<div className="divide-y divide-border">
							{progress.map((entry) => (
								<div
									key={entry.id}
									className="grid grid-cols-3 px-4 py-3 items-center"
								>
									<span className="text-sm font-[family-name:var(--font-mono)] truncate">{entry.id}</span>
									<span className="text-sm font-[family-name:var(--font-mono)] text-right text-muted-foreground">
										{entry.currentBlock !== null
											? entry.currentBlock.toLocaleString()
											: '—'}
									</span>
									<span
										className={`text-xs text-right font-medium ${
											entry.status === 'synced' || entry.status === 'running'
												? 'text-primary'
												: entry.status === 'error'
													? 'text-destructive'
													: 'text-muted-foreground'
										}`}
									>
										{entry.status}
									</span>
								</div>
							))}
						</div>
					</div>
				)}
			</div>

			{/* Configuration Section */}
			<div>
				<p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-3">
					Configuration
				</p>

				<div className="bg-card rounded-lg divide-y divide-border overflow-hidden">
					{[
						{ label: 'JungleBus URL', value: config['junglebus.url'] },
						{ label: 'Store Provider', value: config['store.provider'] },
						{ label: 'Auth Mode', value: config['auth.mode'] },
						{ label: 'Stack Data Path', value: '~/.1sat-wallet/stack/' },
					].map(({ label, value }) => (
						<div key={label} className="flex items-center gap-3 px-4 py-3">
							<span className="flex-1 text-sm text-muted-foreground shrink-0 w-36">
								{label}
							</span>
							<span className="text-sm font-[family-name:var(--font-mono)] text-right truncate max-w-[240px]">
								{value ?? '—'}
							</span>
						</div>
					))}
				</div>

				<p className="text-xs text-muted-foreground mt-2">
					Use the admin panel to edit configuration values.
				</p>
			</div>

			{/* Actions Section */}
			<div className="flex items-center justify-between py-1 gap-4">
				<Button
					variant="outline"
					size="sm"
					onClick={() => onNavigate?.(`${STACK_BASE_URL}/1sat/admin/`)}
				>
					<ExternalLink className="size-3.5 mr-1.5" />
					Open Admin Panel
				</Button>

				<Dialog open={restartDialogOpen} onOpenChange={setRestartDialogOpen}>
					<DialogTrigger asChild>
						<Button variant="secondary" size="sm" disabled={!health.running}>
							<RotateCcw className="size-3.5 mr-1.5" />
							Restart Stack
						</Button>
					</DialogTrigger>
					<DialogContent className="sm:max-w-sm">
						<DialogHeader>
							<DialogTitle>Restart Stack</DialogTitle>
							<DialogDescription>
								This will restart the 1sat-stack process. Active connections
								will be interrupted briefly.
							</DialogDescription>
						</DialogHeader>
						{restartError && (
							<div className="p-3 border border-destructive/50 bg-destructive/5 text-destructive text-xs font-[family-name:var(--font-mono)] rounded-md">
								{restartError}
							</div>
						)}
						<DialogFooter>
							<Button
								variant="ghost"
								onClick={() => setRestartDialogOpen(false)}
								disabled={restarting}
							>
								Cancel
							</Button>
							<Button
								variant="destructive"
								onClick={handleRestart}
								disabled={restarting}
							>
								{restarting ? (
									<>
										<RefreshCw className="size-3.5 mr-1.5 animate-spin" />
										Restarting...
									</>
								) : (
									'Restart'
								)}
							</Button>
						</DialogFooter>
					</DialogContent>
				</Dialog>
			</div>
		</div>
	)
}

// ---------------------------------------------------------------------------
// AI Tab
// ---------------------------------------------------------------------------

interface OllamaModel {
	name: string
	size: string
}

function AiTab() {
	const [settings, setSettings] = useState<AiSettings>(loadAiSettings)
	const [fetchedModels, setFetchedModels] = useState<OllamaModel[]>([])
	const [fetchingModels, setFetchingModels] = useState(false)
	const [fetchError, setFetchError] = useState('')

	const updateSettings = useCallback((patch: Partial<AiSettings>) => {
		setSettings((prev) => ({ ...prev, ...patch }))
	}, [])

	useEffect(() => {
		saveAiSettings(settings)
	}, [settings])

	const handleProviderChange = useCallback(
		(provider: AiProvider) => {
			updateSettings({
				provider,
				baseUrl: PROVIDER_DEFAULTS[provider].baseUrl,
			})
		},
		[updateSettings],
	)

	const handleFetchModels = useCallback(async () => {
		setFetchingModels(true)
		setFetchError('')
		try {
			const params = new URLSearchParams({
				provider: settings.provider,
				baseUrl: settings.baseUrl,
				apiKey: settings.apiKey,
			})
			const res = await fetch(`${WALLET_HTTP_URL}/api/models?${params}`, {
				signal: AbortSignal.timeout(5000),
			})
			if (!res.ok) {
				setFetchError(`Failed to fetch models: HTTP ${res.status}`)
				return
			}
			const data = await res.json()
			const models: OllamaModel[] = (data.models ?? []).map(
				(m: { name: string; size: number }) => ({
					name: m.name,
					size: `${(m.size / 1e9).toFixed(1)} GB`,
				}),
			)
			setFetchedModels(models)
			if (models.length > 0 && !settings.model) {
				updateSettings({ model: models[0].name })
			}
		} catch (err) {
			setFetchError(
				err instanceof Error ? err.message : `Could not connect to ${settings.provider}`,
			)
		} finally {
			setFetchingModels(false)
		}
	}, [settings.provider, settings.baseUrl, settings.apiKey, settings.model, updateSettings])

	return (
		<div className="space-y-8 py-4">
			{/* Provider section */}
			<div>
				<p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-3">
					Provider
				</p>

				<div className="flex items-center justify-between py-3">
					<div>
						<p className="text-sm font-medium">Provider</p>
						<p className="text-xs text-muted-foreground">
							Select your AI provider
						</p>
					</div>
					<Select
						value={settings.provider}
						onValueChange={(v) => handleProviderChange(v as AiProvider)}
					>
						<SelectTrigger size="sm" className="w-40">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{(
								Object.entries(PROVIDER_DEFAULTS) as [
									AiProvider,
									{ label: string; baseUrl: string },
								][]
							).map(([key, { label }]) => (
								<SelectItem key={key} value={key}>
									{label}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>

				<Separator />

				<div className="flex items-center justify-between py-3 gap-4">
					<div className="shrink-0">
						<p className="text-sm font-medium">Base URL</p>
						<p className="text-xs text-muted-foreground">
							API endpoint base URL
						</p>
					</div>
					<Input
						className="max-w-[280px] text-xs font-[family-name:var(--font-mono)] h-8"
						value={settings.baseUrl}
						onChange={(e) => updateSettings({ baseUrl: e.target.value })}
						placeholder="http://localhost:11434/v1"
					/>
				</div>

				<Separator />

				<div className="flex items-center justify-between py-3 gap-4">
					<div className="shrink-0">
						<p className="text-sm font-medium">API Key</p>
						<p className="text-xs text-muted-foreground">
							{settings.provider === 'ollama'
								? 'Not required for Ollama'
								: 'Your provider API key'}
						</p>
					</div>
					<Input
						type="password"
						className="max-w-[280px] text-xs font-[family-name:var(--font-mono)] h-8"
						value={settings.apiKey}
						onChange={(e) => updateSettings({ apiKey: e.target.value })}
						placeholder={
							settings.provider === 'ollama' ? 'Not required' : 'sk-...'
						}
						disabled={settings.provider === 'ollama'}
					/>
				</div>
			</div>

			<Separator />

			{/* Model section */}
			<div>
				<p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-3">
					Model
				</p>

				<div className="flex items-center justify-between py-3 gap-4">
					<div className="shrink-0">
						<p className="text-sm font-medium">Default Model</p>
						<p className="text-xs text-muted-foreground">
							Model used for AI chat
						</p>
					</div>
					<Input
						className="max-w-[280px] text-xs font-[family-name:var(--font-mono)] h-8"
						value={settings.model}
						onChange={(e) => updateSettings({ model: e.target.value })}
						placeholder="llama3:latest"
					/>
				</div>

				<Separator />

				<div className="flex items-center justify-between py-3">
					<div>
						<p className="text-sm font-medium">Fetch Models</p>
						<p className="text-xs text-muted-foreground">
							Load available models from the provider
						</p>
					</div>
					<Button
						variant="secondary"
						size="sm"
						onClick={handleFetchModels}
						disabled={fetchingModels}
					>
						{fetchingModels ? 'Fetching...' : 'Fetch Models'}
					</Button>
				</div>

				{fetchError && (
					<div className="mt-2 p-3 border border-destructive/50 bg-destructive/5 text-destructive text-xs font-[family-name:var(--font-mono)] rounded-md">
						{fetchError}
					</div>
				)}

				{fetchedModels.length > 0 && (
					<div className="mt-3 border border-border rounded-md overflow-hidden">
						<p className="text-[10px] uppercase tracking-widest text-muted-foreground px-3 py-2 bg-muted/30 border-b border-border">
							Available Models
						</p>
						<div className="divide-y divide-border">
							{fetchedModels.map((m) => (
								<button
									key={m.name}
									type="button"
									onClick={() => updateSettings({ model: m.name })}
									className={`flex items-center justify-between w-full px-3 py-2 text-xs hover:bg-muted/50 transition-colors text-left ${
										m.name === settings.model
											? 'text-foreground bg-muted/30'
											: 'text-muted-foreground'
									}`}
								>
									<span className="font-[family-name:var(--font-mono)]">{m.name}</span>
									<span className="text-muted-foreground/60">{m.size}</span>
								</button>
							))}
						</div>
					</div>
				)}
			</div>
		</div>
	)
}

// ---------------------------------------------------------------------------
// Browser Tab
// ---------------------------------------------------------------------------

const SEARCH_MODE_OPTIONS: {
	value: SearchMode
	label: string
	description: string
}[] = [
	{
		value: 'ai',
		label: 'AI Chat (Local)',
		description: 'Route to local AI via Ollama',
	},
	{
		value: 'duckduckgo',
		label: 'DuckDuckGo',
		description: 'Search the web with DuckDuckGo',
	},
	{
		value: 'google',
		label: 'Google',
		description: 'Search the web with Google',
	},
	{
		value: 'custom',
		label: 'Custom',
		description: 'Use a custom search engine URL',
	},
]

function BrowserTab() {
	const [settings, setSettings] = useState<BrowserSettings>(loadBrowserSettings)

	const updateSettings = useCallback((patch: Partial<BrowserSettings>) => {
		setSettings((prev) => {
			const next = { ...prev, ...patch }
			saveBrowserSettings(next)
			return next
		})
	}, [])

	const selectedOption =
		SEARCH_MODE_OPTIONS.find((o) => o.value === settings.searchMode) ??
		SEARCH_MODE_OPTIONS[0]

	return (
		<div className="space-y-8 py-4">
			<div>
				<p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-3">
					Search
				</p>

				<div className="flex items-center justify-between py-3">
					<div>
						<p className="text-sm font-medium">Default Search</p>
						<p className="text-xs text-muted-foreground">
							{selectedOption.description}
						</p>
					</div>
					<Select
						value={settings.searchMode}
						onValueChange={(v) =>
							updateSettings({ searchMode: v as SearchMode })
						}
					>
						<SelectTrigger size="sm" className="w-44">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{SEARCH_MODE_OPTIONS.map((o) => (
								<SelectItem key={o.value} value={o.value}>
									{o.label}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>

				{settings.searchMode === 'custom' && (
					<>
						<Separator />
						<div className="flex items-center justify-between py-3 gap-4">
							<div className="shrink-0">
								<p className="text-sm font-medium">Search URL</p>
								<p className="text-xs text-muted-foreground">
									Use <code className="font-[family-name:var(--font-mono)] text-[10px]">{'{query}'}</code>{' '}
									as the placeholder
								</p>
							</div>
							<Input
								className="max-w-[280px] text-xs font-[family-name:var(--font-mono)] h-8"
								value={settings.customSearchUrl ?? ''}
								onChange={(e) =>
									updateSettings({ customSearchUrl: e.target.value })
								}
								placeholder="https://example.com/search?q={query}"
							/>
						</div>
					</>
				)}

				<Separator />

				<p className="text-xs text-muted-foreground pt-3">
					When you type text in the address bar that is not a URL, it will be
					sent here.
				</p>
			</div>
		</div>
	)
}

// ---------------------------------------------------------------------------
// Appearance Section
// ---------------------------------------------------------------------------

const MODE_OPTIONS: {
	value: AppearanceMode
	label: string
	Icon: React.ComponentType<{ className?: string }>
}[] = [
	{ value: 'light', label: 'Light', Icon: Sun },
	{ value: 'dark', label: 'Dark', Icon: Moon },
	{ value: 'system', label: 'System', Icon: Monitor },
]

function AppearanceSection() {
	const { mode, setMode, resolvedTheme } = useAppearance()

	return (
		<div>
			<p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-3">
				Appearance
			</p>

			{/* Mode selector row */}
			<div className="flex items-center justify-between py-3">
				<div>
					<p className="text-sm font-medium">Color Mode</p>
					<p className="text-xs text-muted-foreground">
						Choose light, dark, or follow system preference
					</p>
				</div>
				<div
					className="flex items-center bg-muted rounded-sm p-0.5 gap-0.5"
					role="group"
					aria-label="Color mode"
				>
					{MODE_OPTIONS.map(({ value, label, Icon }) => (
						<button
							key={value}
							type="button"
							onClick={() => setMode(value)}
							aria-pressed={mode === value}
							className={[
								'flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors rounded-sm',
								mode === value
									? 'bg-background text-foreground shadow-sm'
									: 'text-muted-foreground hover:text-foreground',
							].join(' ')}
						>
							<Icon className="size-3.5 shrink-0" aria-hidden="true" />
							{label}
						</button>
					))}
				</div>
			</div>

			<Separator />

			{/* Theme Token row */}
			<div className="py-3 space-y-2">
				<div className="flex items-center justify-between">
					<div>
						<p className="text-sm font-medium">Theme Token</p>
						<p className="text-xs text-muted-foreground">
							Apply an on-chain theme to customize the wallet appearance
						</p>
					</div>
				</div>
				<ThemeTokenProvider resolvedTheme={resolvedTheme}>
					<ThemeTokenSettings />
				</ThemeTokenProvider>
			</div>
		</div>
	)
}

// ---------------------------------------------------------------------------
// Main SettingsView
// ---------------------------------------------------------------------------

export function SettingsView({
	params,
	onNavigate,
}: { params?: Record<string, string>; onNavigate?: (url: string) => void } = {}) {
	const { lockWallet } = useWallet()

	const handleLock = useCallback(async () => {
		await lockWallet()
	}, [lockWallet])

	// Store the full RPC scan results keyed by WIF so we can pass lockingScript data back
	const [lastScanRaw, setLastScanRaw] = useState<{
		wif: string
		data: Awaited<ReturnType<typeof rpc.request.sweepScan>>
	} | null>(null)

	const handleSweepScan = useCallback(
		async (wif: string): Promise<ScanResult> => {
			const result = await rpc.request.sweepScan({ wif })
			setLastScanRaw({ wif, data: result })
			return {
				funding: result.funding.map((f) => ({
					outpoint: f.outpoint,
					satoshis: f.satoshis,
				})),
				ordinals: result.ordinals.map((o) => ({
					outpoint: o.outpoint,
				})),
				tokens: result.tokens.map((t) => ({
					tokenId: t.tokenId,
					symbol: t.symbol,
					amount: t.utxos.reduce(
						(sum, u) => (BigInt(sum) + BigInt(u.amount)).toString(),
						'0',
					),
				})),
				totalSats: result.totalSats,
			}
		},
		[],
	)

	const handleSweepExecute = useCallback(
		async (wif: string, _assets: ScanResult): Promise<SweepResult> => {
			if (!lastScanRaw || lastScanRaw.wif !== wif) {
				return { error: 'Scan data expired, please re-scan' }
			}
			const result = await rpc.request.sweepBsv({
				wif,
				assets: lastScanRaw.data,
			})
			return result
		},
		[lastScanRaw],
	)

	return (
		<div className="mx-auto max-w-[800px] w-full py-8 px-6">
			<h1 className="text-2xl font-bold mb-6">Settings</h1>

			<Tabs defaultValue={params?.tab ?? 'general'}>
				<TabsList
					variant="line"
					className="w-full justify-start border-b border-border rounded-none pb-0 mb-6 h-auto"
				>
					<TabsTrigger value="general" className="rounded-none pb-3">
						General
					</TabsTrigger>
					<TabsTrigger value="security" className="rounded-none pb-3">
						Security
					</TabsTrigger>
					<TabsTrigger value="network" className="rounded-none pb-3">
						Network
					</TabsTrigger>
					<TabsTrigger value="ai" className="rounded-none pb-3">
						AI
					</TabsTrigger>
					<TabsTrigger value="browser" className="rounded-none pb-3">
						Browser
					</TabsTrigger>
					<TabsTrigger value="about" className="rounded-none pb-3">
						About
					</TabsTrigger>
				</TabsList>

				{/* General Tab */}
				<TabsContent value="general" className="space-y-8">
					{/* Wallet section */}
					<div>
						<p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-3">
							Wallet
						</p>
						<div className="flex items-center justify-between py-3">
							<div>
								<p className="text-sm font-medium">Lock Wallet</p>
								<p className="text-xs text-muted-foreground">
									Lock your wallet and require a password to unlock
								</p>
							</div>
							<Button variant="secondary" size="sm" onClick={handleLock}>
								Lock
							</Button>
						</div>
					</div>

					{/* Appearance section */}
					<AppearanceSection />

					{/* Sweep section */}
					<div>
						<p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-3">
							Sweep
						</p>
						<Separator className="mb-4" />
						<SweepWallet
							onScan={handleSweepScan}
							onSweep={handleSweepExecute}
							onSuccess={() => {}}
						/>
					</div>
				</TabsContent>

				{/* Security Tab */}
				<TabsContent value="security">
					<SecurityTab />
				</TabsContent>

				{/* Network Tab */}
				<TabsContent value="network">
					<NetworkTab onNavigate={onNavigate} />
				</TabsContent>

				{/* AI Tab */}
				<TabsContent value="ai">
					<AiTab />
				</TabsContent>

				{/* Browser Tab */}
				<TabsContent value="browser">
					<BrowserTab />
				</TabsContent>

				{/* About Tab */}
				<TabsContent value="about">
					<div className="space-y-6 py-4">
						<div>
							<p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-3">
								Application
							</p>
							<div className="flex items-center justify-between py-3">
								<p className="text-sm font-medium">App</p>
								<p className="text-sm text-muted-foreground">1Sat</p>
							</div>
							<Separator />
							<div className="flex items-center justify-between py-3">
								<p className="text-sm font-medium">Version</p>
								<p className="text-sm text-muted-foreground">0.0.1</p>
							</div>
							<Separator />
							<div className="flex items-center justify-between py-3">
								<p className="text-sm font-medium">Framework</p>
								<p className="text-sm text-muted-foreground">Electrobun</p>
							</div>
						</div>

						<div>
							<p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-3">
								Links
							</p>
							<div className="flex items-center justify-between py-3">
								<p className="text-sm font-medium">GitHub</p>
								<a
									href="https://github.com/bitcoin-sv/1sat-sdk"
									target="_blank"
									rel="noreferrer"
									className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
								>
									View on GitHub
									<ExternalLink className="size-3.5" />
								</a>
							</div>
						</div>
					</div>
				</TabsContent>
			</Tabs>

			{/* More Settings — native WebKit preferences */}
			<div className="mt-10 pt-4 border-t border-border flex items-center justify-between">
				<p className="text-xs text-muted-foreground">
					Some settings are managed by the system browser.
				</p>
				<button
					type="button"
					onClick={() => onNavigate?.('about:preferences')}
					className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
				>
					More Settings
					<ExternalLink className="size-3" />
				</button>
			</div>
		</div>
	)
}
