import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Input } from '@/components/ui/input'
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@/components/ui/select'
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from '@/components/ui/dialog'
import { useCallback, useEffect, useState } from 'react'
import {
	SweepWallet,
	type ScanResult,
	type SweepResult,
} from '@/components/blocks/sweep-wallet'
import {
	ThemeTokenProvider,
	ThemeTokenSettings,
} from '@/components/blocks/theme-token-provider'
import { rpc } from '../../rpc'
import { useWallet } from '../../hooks/use-wallet'
import { AlertTriangle, ExternalLink, Lock, RefreshCw, Server } from 'lucide-react'
import { MnemonicGridUi } from '@/components/blocks/mnemonic-flow/mnemonic-grid-ui'

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

const PROVIDER_DEFAULTS: Record<AiProvider, { baseUrl: string; label: string }> = {
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
	uptime: string | null
	running: boolean
}

async function fetchStackHealth(): Promise<StackHealth> {
	try {
		const res = await fetch('http://127.0.0.1:8080/1sat/health', {
			signal: AbortSignal.timeout(4000),
		})
		if (!res.ok) return { blockHeight: null, uptime: null, running: false }
		const data = await res.json()
		return {
			blockHeight: data.blockHeight ?? data.block_height ?? null,
			uptime: data.uptime ?? null,
			running: true,
		}
	} catch {
		return { blockHeight: null, uptime: null, running: false }
	}
}

// ---------------------------------------------------------------------------
// Security Tab
// ---------------------------------------------------------------------------

function SecurityTab() {
	const [touchIdEnabled, setTouchIdEnabled] = useState(false)
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
											Anyone with these words can access your wallet and all funds
											inside. Never share them with anyone.
										</DialogDescription>
									</DialogHeader>
									<div className="p-3 border border-amber-500/30 bg-amber-500/5 rounded-md">
										<p className="text-xs text-amber-600 dark:text-amber-400">
											Are you sure you want to reveal your seed phrase? Make sure
											no one can see your screen.
										</p>
									</div>
									<DialogFooter>
										<Button
											variant="ghost"
											onClick={() => setSeedDialogOpen(false)}
										>
											Cancel
										</Button>
										<Button
											variant="destructive"
											onClick={handleRevealConfirm}
										>
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

			{/* Authentication section */}
			<div>
				<p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-3">
					Authentication
				</p>

				<div className="flex items-center justify-between py-3">
					<div>
						<p className="text-sm font-medium">Touch ID</p>
						<p className="text-xs text-muted-foreground">
							Use Touch ID to unlock your wallet
						</p>
					</div>
					{/* Simple toggle — visual only */}
					<button
						type="button"
						role="switch"
						aria-checked={touchIdEnabled}
						onClick={() => setTouchIdEnabled((v) => !v)}
						className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
							touchIdEnabled ? 'bg-primary' : 'bg-input'
						}`}
					>
						<span
							className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-background shadow-lg ring-0 transition-transform ${
								touchIdEnabled ? 'translate-x-4' : 'translate-x-0'
							}`}
						/>
					</button>
				</div>

				<Separator />

				<div className="flex items-center justify-between py-3">
					<div>
						<p className="text-sm font-medium">Auto-Lock Timeout</p>
						<p className="text-xs text-muted-foreground">
							Automatically lock the wallet after inactivity
						</p>
					</div>
					<Select value={autoLock} onValueChange={setAutoLock}>
						<SelectTrigger size="sm" className="w-28">
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
		</div>
	)
}

// ---------------------------------------------------------------------------
// Network Tab
// ---------------------------------------------------------------------------

function NetworkTab() {
	const [health, setHealth] = useState<StackHealth>({
		blockHeight: null,
		uptime: null,
		running: false,
	})
	const [lastChecked, setLastChecked] = useState<Date | null>(null)

	const refresh = useCallback(async () => {
		const result = await fetchStackHealth()
		setHealth(result)
		setLastChecked(new Date())
	}, [])

	useEffect(() => {
		refresh()
		const interval = setInterval(refresh, 10_000)
		return () => clearInterval(interval)
	}, [refresh])

	return (
		<div className="space-y-8 py-4">
			{/* Stack status section */}
			<div>
				<div className="flex items-center justify-between mb-3">
					<p className="text-[10px] uppercase tracking-widest text-muted-foreground">
						1Sat Stack
					</p>
					{lastChecked && (
						<p className="text-[10px] text-muted-foreground">
							Updated {lastChecked.toLocaleTimeString()}
						</p>
					)}
				</div>

				<div className="flex items-center justify-between py-3">
					<p className="text-sm font-medium">Status</p>
					<div className="flex items-center gap-2">
						<span
							className={`inline-block size-2 rounded-full ${
								health.running ? 'bg-green-500' : 'bg-red-500'
							}`}
						/>
						<span className="text-sm text-muted-foreground">
							{health.running ? 'Running' : 'Stopped'}
						</span>
					</div>
				</div>

				<Separator />

				<div className="flex items-center justify-between py-3">
					<p className="text-sm font-medium">Block Height</p>
					<p className="text-sm text-muted-foreground font-mono">
						{health.blockHeight !== null
							? health.blockHeight.toLocaleString()
							: '—'}
					</p>
				</div>

				<Separator />

				<div className="flex items-center justify-between py-3">
					<p className="text-sm font-medium">Uptime</p>
					<p className="text-sm text-muted-foreground font-mono">
						{health.uptime ?? '—'}
					</p>
				</div>
			</div>

			<Separator />

			{/* Configuration section */}
			<div>
				<p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-3">
					Configuration
				</p>

				<div className="flex items-center justify-between py-3">
					<p className="text-sm font-medium">JungleBus URL</p>
					<p className="text-sm text-muted-foreground font-mono text-right max-w-[280px] truncate">
						https://junglebus.gorillapool.io
					</p>
				</div>

				<Separator />

				<div className="flex items-center justify-between py-3">
					<p className="text-sm font-medium">Stack Data Path</p>
					<p className="text-sm text-muted-foreground font-mono">
						~/.1sat-wallet/stack/
					</p>
				</div>

				<Separator />

				<div className="flex items-center justify-between py-3">
					<p className="text-sm font-medium">Admin Panel</p>
					<a
						href="http://127.0.0.1:8080"
						target="_blank"
						rel="noreferrer"
						className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
					>
						Open Admin Panel
						<ExternalLink className="size-3.5" />
					</a>
				</div>

				<Separator />

				<div className="flex items-center justify-between py-3">
					<div>
						<p className="text-sm font-medium">Restart Stack</p>
						<p className="text-xs text-muted-foreground">
							Restart all 1sat-stack services
						</p>
					</div>
					<Button variant="secondary" size="sm" disabled>
						<RefreshCw className="size-3.5 mr-1.5" />
						Restart
					</Button>
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
		setSettings((prev) => {
			const next = { ...prev, ...patch }
			saveAiSettings(next)
			return next
		})
	}, [])

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
			const ollamaBase = settings.baseUrl.replace('/v1', '')
			const res = await fetch(`${ollamaBase}/api/tags`, {
				signal: AbortSignal.timeout(5000),
			})
			if (!res.ok) {
				setFetchError(`Failed to fetch models: HTTP ${res.status}`)
				return
			}
			const data = await res.json()
			const models: OllamaModel[] = (
				data.models ?? []
			).map((m: { name: string; size: number }) => ({
				name: m.name,
				size: `${(m.size / 1e9).toFixed(1)} GB`,
			}))
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

	const handleSweepScan = useCallback(async (wif: string): Promise<ScanResult> => {
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
	}, [])

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
				<TabsList variant="line" className="w-full justify-start border-b border-border rounded-none pb-0 mb-6 h-auto">
					<TabsTrigger value="general" className="rounded-none pb-3">General</TabsTrigger>
					<TabsTrigger value="security" className="rounded-none pb-3">Security</TabsTrigger>
					<TabsTrigger value="network" className="rounded-none pb-3">Network</TabsTrigger>
					<TabsTrigger value="ai" className="rounded-none pb-3">AI</TabsTrigger>
					<TabsTrigger value="about" className="rounded-none pb-3">About</TabsTrigger>
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
									Apply an on-chain theme token to customize the wallet appearance
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
