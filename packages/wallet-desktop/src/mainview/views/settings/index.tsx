import {
	type ScanResult,
	type SweepResult,
	SweepWallet,
} from '@/components/blocks/sweep-wallet'
import {
	ThemeTokenProvider,
	ThemeTokenSettings,
} from '@/components/blocks/theme-token-provider'
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
	CheckCircle2,
	Download,
	ExternalLink,
	Globe,
	Info,
	Loader2,
	Monitor,
	Moon,
	RefreshCw,
	RotateCcw,
	ShieldCheck,
	Sun,
	Trash2,
	XCircle,
} from 'lucide-react'
import { Switch } from 'radix-ui'
import { useCallback, useEffect, useState } from 'react'
import {
	type AppearanceMode,
	useAppearance,
} from '../../hooks/use-appearance'
import {
	type BrowserSettings,
	type SearchMode,
	WALLET_HTTP_PORT,
	WALLET_HTTP_URL,
	WALLET_HTTPS_PORT,
	WALLET_MCP_PORT,
	loadBrowserSettings,
	saveBrowserSettings,
} from '../../../shared/constants'
import type { AppVersionInfo, UpdateStatusPayload } from '../../../shared/types'
import { useWallet } from '../../hooks/use-wallet'
import { onUpdateStatus, rpc } from '../../rpc'

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

const DEFAULT_REMOTE_URL = 'https://api.1sat.app'

function NetworkTab(_props: { onNavigate?: (url: string) => void }) {
	const [remoteEnabled, setRemoteEnabled] = useState(false)
	const [remoteUrl, setRemoteUrl] = useState(DEFAULT_REMOTE_URL)
	const [beefFallback, setBeefFallback] = useState(true)
	const [spendFallback, setSpendFallback] = useState(true)
	const [saving, setSaving] = useState(false)
	const [loaded, setLoaded] = useState(false)

	useEffect(() => {
		rpc.request.getConfig({ prefix: 'remote.' }).then((result) => {
			const cfg = result.config
			setRemoteEnabled(cfg['remote.enabled'] === 'true')
			if (cfg['remote.url']) setRemoteUrl(cfg['remote.url'])
			setBeefFallback(cfg['remote.beef'] !== 'false')
			setSpendFallback(cfg['remote.spends'] !== 'false')
			setLoaded(true)
		})
	}, [])

	const saveConfig = useCallback(
		async (entries: Record<string, string>) => {
			setSaving(true)
			try {
				await rpc.request.setConfig({ entries })
			} finally {
				setSaving(false)
			}
		},
		[],
	)

	const handleRemoteToggle = useCallback(
		(checked: boolean) => {
			setRemoteEnabled(checked)
			saveConfig({ 'remote.enabled': String(checked) })
		},
		[saveConfig],
	)

	const handleUrlBlur = useCallback(() => {
		saveConfig({ 'remote.url': remoteUrl })
	}, [remoteUrl, saveConfig])

	const handleBeefToggle = useCallback(
		(checked: boolean) => {
			setBeefFallback(checked)
			saveConfig({ 'remote.beef': String(checked) })
		},
		[saveConfig],
	)

	const handleSpendToggle = useCallback(
		(checked: boolean) => {
			setSpendFallback(checked)
			saveConfig({ 'remote.spends': String(checked) })
		},
		[saveConfig],
	)

	const switchClasses = (enabled: boolean, disabled: boolean) =>
		[
			'relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors',
			'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
			'disabled:cursor-not-allowed disabled:opacity-50',
			enabled ? 'bg-primary' : 'bg-input',
			disabled ? 'opacity-50' : '',
		].join(' ')

	const thumbClasses = (enabled: boolean) =>
		[
			'pointer-events-none block size-4 rounded-full bg-white shadow-sm ring-0 transition-transform',
			enabled ? 'translate-x-4' : 'translate-x-0',
		].join(' ')

	return (
		<div className="space-y-8 py-4">
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

			{/* Remote Server Configuration */}
			<div>
				<p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-3">
					Remote Server
				</p>
				<div className="bg-card rounded-xl p-5 space-y-4">
					{/* Enable toggle */}
					<div className="flex items-center justify-between">
						<div>
							<p className="text-sm font-medium">Enable Remote</p>
							<p className="text-xs text-muted-foreground mt-0.5">
								Connect to a 1Sat server for transaction and content lookups
							</p>
						</div>
						<Switch.Root
							checked={remoteEnabled}
							disabled={!loaded || saving}
							onCheckedChange={handleRemoteToggle}
							className={switchClasses(remoteEnabled, !loaded || saving)}
						>
							<Switch.Thumb className={thumbClasses(remoteEnabled)} />
						</Switch.Root>
					</div>

					<Separator />

					{/* URL */}
					<div className="space-y-1.5">
						<label htmlFor="remote-url" className="text-xs text-muted-foreground">
							Server URL
						</label>
						<Input
							id="remote-url"
							value={remoteUrl}
							onChange={(e) => setRemoteUrl(e.target.value)}
							onBlur={handleUrlBlur}
							placeholder={DEFAULT_REMOTE_URL}
							disabled={!loaded || saving}
							className="font-[family-name:var(--font-mono)] text-sm"
						/>
					</div>

					<Separator />

					{/* Beef fallback toggle */}
					<div className="flex items-center justify-between">
						<div>
							<p className="text-sm font-medium">Transaction Lookups</p>
							<p className="text-xs text-muted-foreground mt-0.5">
								Fetch BEEF data from the remote server when not available locally
							</p>
						</div>
						<Switch.Root
							checked={beefFallback && remoteEnabled}
							disabled={!loaded || saving || !remoteEnabled}
							onCheckedChange={handleBeefToggle}
							className={switchClasses(beefFallback && remoteEnabled, !remoteEnabled)}
						>
							<Switch.Thumb className={thumbClasses(beefFallback && remoteEnabled)} />
						</Switch.Root>
					</div>

					{/* Spend fallback toggle */}
					<div className="flex items-center justify-between">
						<div>
							<p className="text-sm font-medium">Spend Lookups</p>
							<p className="text-xs text-muted-foreground mt-0.5">
								Query spend data from the remote server when not indexed locally
							</p>
						</div>
						<Switch.Root
							checked={spendFallback && remoteEnabled}
							disabled={!loaded || saving || !remoteEnabled}
							onCheckedChange={handleSpendToggle}
							className={switchClasses(spendFallback && remoteEnabled, !remoteEnabled)}
						>
							<Switch.Thumb className={thumbClasses(spendFallback && remoteEnabled)} />
						</Switch.Root>
					</div>
				</div>
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
// About Tab
// ---------------------------------------------------------------------------

function AboutTab() {
	const [versionInfo, setVersionInfo] = useState<AppVersionInfo | null>(null)
	const [updateStatus, setUpdateStatus] = useState<UpdateStatusPayload | null>(
		null,
	)

	// Fetch version info on mount
	useEffect(() => {
		rpc.request.getAppVersion().then(setVersionInfo)
	}, [])

	// Subscribe to update status pushes from the bun process
	useEffect(() => {
		return onUpdateStatus((payload) => {
			setUpdateStatus(payload)
		})
	}, [])

	const handleCheckForUpdates = useCallback(() => {
		setUpdateStatus({ status: 'checking' })
		rpc.request.checkForUpdates()
	}, [])

	const handleApplyUpdate = useCallback(() => {
		rpc.request.applyUpdate()
	}, [])

	const statusDisplay = updateStatus?.status
	const isActive =
		statusDisplay === 'checking' || statusDisplay === 'downloading'

	return (
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
					<p className="text-sm text-muted-foreground font-[family-name:var(--font-mono)]">
						{versionInfo?.version ?? '...'}
					</p>
				</div>
				<Separator />
				<div className="flex items-center justify-between py-3">
					<p className="text-sm font-medium">Channel</p>
					<Badge variant="secondary" className="font-[family-name:var(--font-mono)]">
						{versionInfo?.channel ?? '...'}
					</Badge>
				</div>
				<Separator />
				<div className="flex items-center justify-between py-3">
					<p className="text-sm font-medium">Framework</p>
					<p className="text-sm text-muted-foreground">Electrobun</p>
				</div>
			</div>

			{/* Update section */}
			<div>
				<p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-3">
					Updates
				</p>

				<div className="bg-card rounded-xl p-5 space-y-4">
					{/* Status indicator */}
					<div className="flex items-center gap-3">
						{statusDisplay === 'checking' && (
							<>
								<Loader2 className="size-5 animate-spin text-muted-foreground" />
								<div>
									<p className="text-sm font-medium">Checking for updates...</p>
								</div>
							</>
						)}
						{statusDisplay === 'downloading' && (
							<>
								<Download className="size-5 text-primary animate-pulse" />
								<div>
									<p className="text-sm font-medium">
										Downloading update{updateStatus?.version ? ` v${updateStatus.version}` : ''}...
									</p>
								</div>
							</>
						)}
						{statusDisplay === 'ready' && (
							<>
								<CheckCircle2 className="size-5 text-primary" />
								<div>
									<p className="text-sm font-medium">
										Update ready{updateStatus?.version ? ` — v${updateStatus.version}` : ''}
									</p>
									<p className="text-xs text-muted-foreground mt-0.5">
										Restart the app to apply the update.
									</p>
								</div>
							</>
						)}
						{statusDisplay === 'up-to-date' && (
							<>
								<CheckCircle2 className="size-5 text-muted-foreground" />
								<div>
									<p className="text-sm font-medium">You're up to date</p>
									<p className="text-xs text-muted-foreground mt-0.5">
										Running the latest version.
									</p>
								</div>
							</>
						)}
						{statusDisplay === 'error' && (
							<>
								<XCircle className="size-5 text-destructive" />
								<div>
									<p className="text-sm font-medium">Update check failed</p>
									<p className="text-xs text-muted-foreground mt-0.5">
										{updateStatus?.error ?? 'An unknown error occurred.'}
									</p>
								</div>
							</>
						)}
						{!statusDisplay && (
							<>
								<Info className="size-5 text-muted-foreground" />
								<div>
									<p className="text-sm font-medium">Updates</p>
									<p className="text-xs text-muted-foreground mt-0.5">
										Check for the latest version of 1Sat.
									</p>
								</div>
							</>
						)}
					</div>

					{/* Action buttons */}
					<div className="flex gap-2">
						{statusDisplay === 'ready' ? (
							<Button size="sm" onClick={handleApplyUpdate}>
								<RotateCcw className="size-3.5 mr-1.5" />
								Restart to Update
							</Button>
						) : (
							<Button
								variant="secondary"
								size="sm"
								onClick={handleCheckForUpdates}
								disabled={isActive}
							>
								{isActive ? (
									<Loader2 className="size-3.5 mr-1.5 animate-spin" />
								) : (
									<RefreshCw className="size-3.5 mr-1.5" />
								)}
								Check for Updates
							</Button>
						)}
					</div>
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
					<AboutTab />
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
