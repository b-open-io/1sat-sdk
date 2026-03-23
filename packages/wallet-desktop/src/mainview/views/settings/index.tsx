import { MnemonicGridUi } from '@/components/blocks/mnemonic-flow/mnemonic-grid-ui'
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
	AlertTriangle,
	ExternalLink,
	Globe,
	Lock,
	ShieldCheck,
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useWallet } from '../../hooks/use-wallet'
import { rpc } from '../../rpc'

// ---------------------------------------------------------------------------
// AI Settings types and helpers
// ---------------------------------------------------------------------------

type AiProvider = 'ollama' | 'openrouter' | 'openai' | 'anthropic'

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
		model: 'llama3:latest',
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
		const res = await fetch('http://127.0.0.1:8080/1sat/health', {
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

interface ServiceStatus {
	name: string
	port: number
	reachable: boolean | null
}

async function checkService(port: number): Promise<boolean> {
	try {
		await fetch(`http://127.0.0.1:${port}`, {
			signal: AbortSignal.timeout(2000),
			mode: 'no-cors',
		})
		// no-cors fetch resolves (opaque response) when the server is up
		return true
	} catch {
		return false
	}
}

// ---------------------------------------------------------------------------
// Security Tab
// ---------------------------------------------------------------------------

function SecurityTab() {
	const [autoLock, setAutoLock] = useState('15')
	const [seedDialogOpen, setSeedDialogOpen] = useState(false)
	const [seedConfirmed, setSeedConfirmed] = useState(false)

	const handleRevealConfirm = useCallback(() => {
		setSeedConfirmed(true)
	}, [])

	const handleSeedDialogClose = useCallback((open: boolean) => {
		setSeedDialogOpen(open)
		if (!open) setSeedConfirmed(false)
	}, [])

	// Placeholder 12 words — in a real implementation these would come from RPC
	const PLACEHOLDER_WORDS = Array(12).fill('') as string[]

	return (
		<div className="space-y-8 py-4">
			{/* Vault Status card */}
			<div className="bg-card rounded-lg p-4 flex items-center gap-3">
				<div className="flex items-center justify-center size-10 rounded-full bg-green-500/10 shrink-0">
					<ShieldCheck className="size-5 text-green-500" />
				</div>
				<div className="flex-1 min-w-0">
					<p className="text-sm font-semibold">Vault Protected</p>
					<p className="text-sm text-muted-foreground">
						Touch ID (Secure Enclave)
					</p>
				</div>
				<span className="text-xs bg-green-500/20 text-green-400 px-2 py-0.5 rounded-full shrink-0">
					Active
				</span>
			</div>

			{/* Backup section */}
			<div>
				<p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-3">
					Backup
				</p>

				<div className="flex items-center justify-between py-3">
					<div className="flex items-start gap-3">
						<AlertTriangle className="size-4 text-amber-500 mt-0.5 shrink-0" />
						<div>
							<p className="text-sm font-medium">Backup Seed Phrase</p>
							<p className="text-xs text-muted-foreground">
								Write down your 12 recovery words and keep them safe
							</p>
						</div>
					</div>
					<Dialog open={seedDialogOpen} onOpenChange={handleSeedDialogClose}>
						<DialogTrigger asChild>
							<Button variant="secondary" size="sm">
								Reveal
							</Button>
						</DialogTrigger>
						<DialogContent className="sm:max-w-md">
							{!seedConfirmed ? (
								<>
									<DialogHeader>
										<DialogTitle>Reveal Seed Phrase</DialogTitle>
										<DialogDescription>
											Anyone with these words can access your wallet and all
											funds inside. Never share them with anyone.
										</DialogDescription>
									</DialogHeader>
									<div className="p-3 border border-amber-500/30 bg-amber-500/5 rounded-md">
										<p className="text-xs text-amber-600 dark:text-amber-400">
											Are you sure you want to reveal your seed phrase? Make
											sure no one can see your screen.
										</p>
									</div>
									<DialogFooter>
										<Button
											variant="ghost"
											onClick={() => setSeedDialogOpen(false)}
										>
											Cancel
										</Button>
										<Button variant="destructive" onClick={handleRevealConfirm}>
											Yes, Show My Seed Phrase
										</Button>
									</DialogFooter>
								</>
							) : (
								<>
									<DialogHeader>
										<DialogTitle>Your Seed Phrase</DialogTitle>
										<DialogDescription>
											Write these words down in order and store them somewhere
											safe offline.
										</DialogDescription>
									</DialogHeader>
									<div className="p-3 border border-amber-500/30 bg-amber-500/5 rounded-md mb-2">
										<p className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1.5">
											<Lock className="size-3 shrink-0" />
											Seed phrase backup not available (protected by Secure
											Enclave)
										</p>
									</div>
									<MnemonicGridUi words={PLACEHOLDER_WORDS} columns={3} />
									<DialogFooter>
										<Button
											variant="secondary"
											onClick={() => setSeedDialogOpen(false)}
										>
											Done
										</Button>
									</DialogFooter>
								</>
							)}
						</DialogContent>
					</Dialog>
				</div>
			</div>

			<Separator />

			{/* Auto-Lock section */}
			<div>
				<p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-3">
					Authentication
				</p>

				<div className="flex items-center justify-between py-3">
					<div>
						<p className="text-sm font-medium">Auto-Lock</p>
						<p className="text-xs text-muted-foreground">
							Lock wallet after inactivity
						</p>
					</div>
					<Select value={autoLock} onValueChange={setAutoLock}>
						<SelectTrigger size="sm" className="w-32 bg-card border-border">
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
			</div>

			<Separator />

			{/* Connected Apps section */}
			<div>
				<p className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
					Connected Apps
				</p>
				<div className="flex flex-col items-center justify-center py-8 gap-2 text-center">
					<Globe className="size-8 text-muted-foreground/40" />
					<p className="text-sm text-muted-foreground">No connected apps yet</p>
					<p className="text-xs text-muted-foreground/60 max-w-xs">
						Apps you authorize will appear here. You can revoke access at any
						time.
					</p>
				</div>
			</div>
		</div>
	)
}

// ---------------------------------------------------------------------------
// Network Tab
// ---------------------------------------------------------------------------

const SERVICES: { name: string; port: number }[] = [
	{ name: 'BRC-100 HTTP', port: 3321 },
	{ name: 'BRC-100 HTTPS', port: 2121 },
	{ name: 'MCP Server', port: 3322 },
]

function NetworkTab() {
	const [health, setHealth] = useState<StackHealth>({
		blockHeight: null,
		uptimeSeconds: null,
		running: false,
		syncPercent: null,
	})
	const [lastChecked, setLastChecked] = useState<Date | null>(null)
	const [services, setServices] = useState<ServiceStatus[]>(
		SERVICES.map((s) => ({ ...s, reachable: null })),
	)

	const refreshServices = useCallback(async () => {
		const results = await Promise.all(
			SERVICES.map(async (s) => ({
				...s,
				reachable: await checkService(s.port),
			})),
		)
		setServices(results)
	}, [])

	const refresh = useCallback(async () => {
		const result = await fetchStackHealth()
		setHealth(result)
		setLastChecked(new Date())
	}, [])

	useEffect(() => {
		refresh()
		refreshServices()
		const interval = setInterval(() => {
			refresh()
			refreshServices()
		}, 10_000)
		return () => clearInterval(interval)
	}, [refresh, refreshServices])

	const syncPercent = health.syncPercent ?? (health.running ? 100 : null)
	const uptimeDisplay =
		health.uptimeSeconds !== null ? formatUptime(health.uptimeSeconds) : '—'

	return (
		<div className="space-y-8 py-4">
			{/* Stack Health grid */}
			<div>
				<div className="flex items-center justify-between mb-3">
					<p className="text-[10px] uppercase tracking-widest text-muted-foreground">
						Stack Health
					</p>
					{lastChecked && (
						<p className="text-[10px] text-muted-foreground">
							Updated {lastChecked.toLocaleTimeString()}
						</p>
					)}
				</div>

				<div className="grid grid-cols-3 gap-3">
					{/* Block Height */}
					<div className="bg-card rounded-lg p-4">
						<p className="text-xs text-muted-foreground mb-1">Block Height</p>
						<p className="text-xl font-bold font-mono">
							{health.blockHeight !== null
								? health.blockHeight.toLocaleString()
								: '—'}
						</p>
					</div>

					{/* Uptime */}
					<div className="bg-card rounded-lg p-4">
						<p className="text-xs text-muted-foreground mb-1">Uptime</p>
						<p className="text-xl font-bold font-mono">{uptimeDisplay}</p>
					</div>

					{/* Status */}
					<div className="bg-card rounded-lg p-4">
						<p className="text-xs text-muted-foreground mb-1">Status</p>
						<p
							className={`text-xl font-bold ${
								health.running ? 'text-green-400' : 'text-red-400'
							}`}
						>
							{health.running ? 'Running' : 'Offline'}
						</p>
					</div>
				</div>
			</div>

			{/* Sync Progress */}
			<div>
				<div className="flex items-center justify-between mb-2">
					<p className="text-[10px] uppercase tracking-widest text-muted-foreground">
						Sync
					</p>
					<p className="text-xs text-muted-foreground font-mono">
						{syncPercent !== null ? `${syncPercent}%` : '—'}
					</p>
				</div>
				<div className="h-1.5 w-full rounded-full bg-border overflow-hidden">
					<div
						className="h-full rounded-full bg-primary transition-all duration-500"
						style={{ width: syncPercent !== null ? `${syncPercent}%` : '0%' }}
					/>
				</div>
				{syncPercent === 100 && (
					<p className="text-xs text-muted-foreground mt-1.5">Synced</p>
				)}
			</div>

			{/* Services list */}
			<div>
				<p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-3">
					Services
				</p>
				<div className="bg-card rounded-lg divide-y divide-border overflow-hidden">
					{services.map((svc) => (
						<div key={svc.port} className="flex items-center gap-3 px-4 py-3">
							<span
								className={`size-2 rounded-full shrink-0 ${
									svc.reachable === null
										? 'bg-muted-foreground/30'
										: svc.reachable
											? 'bg-green-500'
											: 'bg-red-500'
								}`}
							/>
							<span className="flex-1 text-sm">{svc.name}</span>
							<span className="text-xs text-muted-foreground font-mono">
								:{svc.port}
							</span>
						</div>
					))}
				</div>
			</div>

			{/* Open Stack Admin button */}
			<div className="flex items-center justify-between py-1">
				<div>
					<p className="text-sm font-medium">Stack Admin</p>
					<p className="text-xs text-muted-foreground">
						Manage the local 1Sat stack
					</p>
				</div>
				<Button
					variant="outline"
					size="sm"
					onClick={() => window.open('http://127.0.0.1:8080/1sat/admin')}
				>
					<ExternalLink className="size-3.5 mr-1.5" />
					Open Stack Admin
				</Button>
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
			const res = await fetch('http://localhost:3321/api/models', {
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
				err instanceof Error ? err.message : 'Could not connect to Ollama',
			)
		} finally {
			setFetchingModels(false)
		}
	}, [settings.baseUrl, settings.model, updateSettings])

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
						className="max-w-[280px] text-xs font-mono h-8"
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
						className="max-w-[280px] text-xs font-mono h-8"
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
						className="max-w-[280px] text-xs font-mono h-8"
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
							Load available models from Ollama
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
					<div className="mt-2 p-3 border border-destructive/50 bg-destructive/5 text-destructive text-xs font-mono rounded-md">
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
									<span className="font-mono">{m.name}</span>
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
// Main SettingsView
// ---------------------------------------------------------------------------

export function SettingsView() {
	const { lockWallet, deleteWallet } = useWallet()
	const [confirmDelete, setConfirmDelete] = useState(false)
	const [error, setError] = useState('')

	const handleLock = useCallback(async () => {
		await lockWallet()
	}, [lockWallet])

	const handleDelete = useCallback(async () => {
		if (!confirmDelete) {
			setConfirmDelete(true)
			return
		}
		setError('')
		try {
			const result = await deleteWallet()
			if (!result.success) {
				setError(result.error ?? 'Failed to delete wallet')
			}
		} catch (err) {
			setError(String(err))
		}
	}, [confirmDelete, deleteWallet])

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

			<Tabs defaultValue="general">
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
						<Separator />
						<div className="flex items-center justify-between py-3">
							<div>
								<p className="text-sm font-medium">Delete Wallet</p>
								<p className="text-xs text-muted-foreground">
									Permanently remove this wallet from this device
								</p>
							</div>
							<div className="flex items-center gap-2">
								{confirmDelete && (
									<Button
										variant="ghost"
										size="sm"
										onClick={() => setConfirmDelete(false)}
									>
										Cancel
									</Button>
								)}
								<Button
									variant="ghost"
									size="sm"
									className="text-destructive hover:text-destructive hover:bg-destructive/10"
									onClick={handleDelete}
								>
									{confirmDelete ? 'Confirm Delete' : 'Delete'}
								</Button>
							</div>
						</div>
						{error && (
							<div className="mt-2 p-3 border border-destructive text-destructive text-sm font-mono">
								{error}
							</div>
						)}
					</div>

					{/* Theme section */}
					<div>
						<p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-3">
							Theme
						</p>
						<div className="flex items-center justify-between py-3">
							<div>
								<p className="text-sm font-medium">Theme Token</p>
								<p className="text-xs text-muted-foreground">
									Apply an on-chain theme token to customize the wallet
									appearance
								</p>
							</div>
							<ThemeTokenProvider>
								<ThemeTokenSettings />
							</ThemeTokenProvider>
						</div>
					</div>

					{/* Sweep section */}
					<div>
						<p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-3">
							Sweep
						</p>
						<Separator className="mb-4" />
						<SweepWallet
							onScan={handleSweepScan}
							onSweep={handleSweepExecute}
							onSuccess={(result) => {
								if (result.txid) {
									console.log('Sweep complete:', result.txid)
								}
							}}
						/>
					</div>
				</TabsContent>

				{/* Security Tab */}
				<TabsContent value="security">
					<SecurityTab />
				</TabsContent>

				{/* Network Tab */}
				<TabsContent value="network">
					<NetworkTab />
				</TabsContent>

				{/* AI Tab */}
				<TabsContent value="ai">
					<AiTab />
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
								<p className="text-sm text-muted-foreground">1Sat Wallet</p>
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
		</div>
	)
}
