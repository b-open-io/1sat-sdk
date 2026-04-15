import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Kbd } from '@/components/ui/kbd'
import { Label } from '@/components/ui/label'
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Spinner } from '@/components/ui/spinner'
import { type Step, StepIndicator } from '@/components/ui/step-indicator'
import { useHotkeys } from '@tanstack/react-hotkeys'
import {
	CheckCircle2,
	ExternalLink,
	Monitor,
	Moon,
	Palette,
	RefreshCw,
	Server,
	SkipForward,
	Sparkles,
	Sun,
	User,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import Avatar from 'sigma-avatars'
import {
	AI_SETTINGS_KEY,
	type AiProvider,
	LOCAL_PROVIDERS,
	PROVIDER_DEFAULTS,
} from '../../../shared/ai-providers'
import { type AppearanceMode, useAppearance } from '../../hooks/use-appearance'
import { rpc } from '../../rpc'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STEP_LABELS = ['Profile', 'Stack', 'AI', 'Appearance'] as const
const STEP_COUNT = STEP_LABELS.length

const THEME_COLORS = [
	'var(--chart-1)',
	'var(--chart-2)',
	'var(--chart-3)',
	'var(--chart-4)',
	'var(--chart-5)',
]

const COLOR_OPTIONS = [
	{ name: 'blue', bg: 'bg-blue-500', ring: 'ring-blue-500' },
	{ name: 'amber', bg: 'bg-amber-500', ring: 'ring-amber-500' },
	{ name: 'rose', bg: 'bg-rose-500', ring: 'ring-rose-500' },
	{ name: 'emerald', bg: 'bg-emerald-500', ring: 'ring-emerald-500' },
	{ name: 'violet', bg: 'bg-violet-500', ring: 'ring-violet-500' },
	{ name: 'cyan', bg: 'bg-cyan-500', ring: 'ring-cyan-500' },
	{ name: 'orange', bg: 'bg-orange-500', ring: 'ring-orange-500' },
	{ name: 'pink', bg: 'bg-pink-500', ring: 'ring-pink-500' },
]

// ---------------------------------------------------------------------------
// Wizard
// ---------------------------------------------------------------------------

export function SetupWizard({ onComplete }: { onComplete: () => void }) {
	const [currentStep, setCurrentStep] = useState(0)

	const goTo = useCallback((step: number) => {
		setCurrentStep(Math.max(0, Math.min(step, STEP_COUNT - 1)))
	}, [])

	const advance = useCallback(() => {
		setCurrentStep((s) => Math.min(s + 1, STEP_COUNT - 1))
	}, [])

	const goBack = useCallback(() => {
		setCurrentStep((s) => Math.max(s - 1, 0))
	}, [])

	// Arrow key navigation between steps
	useHotkeys([
		{
			hotkey: 'ArrowLeft',
			callback: () => {
				if (document.activeElement?.tagName === 'INPUT') return
				if (document.activeElement?.tagName === 'SELECT') return
				goBack()
			},
		},
		{
			hotkey: 'ArrowRight',
			callback: () => {
				if (document.activeElement?.tagName === 'INPUT') return
				if (document.activeElement?.tagName === 'SELECT') return
				advance()
			},
		},
	])

	const steps: Step[] = STEP_LABELS.map((label, i) => ({
		id: String(i),
		label,
		status:
			i < currentStep ? 'complete' : i === currentStep ? 'active' : 'pending',
	}))

	return (
		<div className="min-h-screen flex items-center justify-center bg-background p-4">
			<div className="max-w-lg w-full">
				<div className="text-center mb-8">
					<h1 className="text-2xl font-bold text-foreground mb-1">
						Welcome to 1Sat
					</h1>
					<p className="text-sm text-muted-foreground">
						Let's configure a few things to get you started.
					</p>
				</div>

				<StepIndicator
					steps={steps}
					className="mb-8 justify-center"
					onStepClick={goTo}
				/>

				<Card>
					<CardContent>
						{currentStep === 0 && <ProfileStep onAdvance={advance} />}
						{currentStep === 1 && <StackStep onAdvance={advance} />}
						{currentStep === 2 && <AiStep onAdvance={advance} />}
						{currentStep === 3 && <AppearanceStep onComplete={onComplete} />}
					</CardContent>
				</Card>

				{/* Keyboard hints */}
				<p className="text-[10px] text-muted-foreground/60 text-center mt-3">
					Use <Kbd>&larr;</Kbd> <Kbd>&rarr;</Kbd> arrow keys to navigate,{' '}
					<Kbd>Enter</Kbd> to continue
				</p>
			</div>
		</div>
	)
}

// ---------------------------------------------------------------------------
// Step 1: Profile
// ---------------------------------------------------------------------------

function ProfileStep({ onAdvance }: { onAdvance: () => void }) {
	const [loading, setLoading] = useState(true)
	const [displayName, setDisplayName] = useState('')
	const [selectedColor, setSelectedColor] = useState('blue')
	const [accountId, setAccountId] = useState<string | null>(null)
	const [identityKey, setIdentityKey] = useState('')
	const [bapId, setBapId] = useState<string | null>(null)
	const [saving, setSaving] = useState(false)

	useEffect(() => {
		Promise.all([
			rpc.request.getActiveAccount().catch(() => ({ account: null })),
			rpc.request.getIdentity().catch(() => ({ bapId: null, profile: null })),
		])
			.then(([active, identity]) => {
				if (active.account) {
					setAccountId(active.account.id)
					setIdentityKey(active.account.identityKey)
					if (active.account.displayName)
						setDisplayName(active.account.displayName)
					if (active.account.color) setSelectedColor(active.account.color)
				}
				if (identity.bapId) setBapId(identity.bapId)
			})
			.finally(() => setLoading(false))
	}, [])

	const handleSave = useCallback(async () => {
		if (!displayName.trim() || !accountId) return
		setSaving(true)
		try {
			await rpc.request.updateAccount({
				accountId,
				displayName: displayName.trim(),
				color: selectedColor,
			})
			onAdvance()
		} catch (err) {
			console.error('Failed to update profile:', err)
			setSaving(false)
		}
	}, [accountId, displayName, selectedColor, onAdvance])

	useHotkeys([
		{
			hotkey: 'Enter',
			callback: () => {
				if (displayName.trim() && !saving) handleSave()
			},
		},
	])

	if (loading) {
		return (
			<div className="flex flex-col items-center gap-4 py-8">
				<Spinner className="size-6" />
				<p className="text-sm text-muted-foreground">Loading profile...</p>
			</div>
		)
	}

	const colorOption =
		COLOR_OPTIONS.find((c) => c.name === selectedColor) ?? COLOR_OPTIONS[0]

	return (
		<div className="flex flex-col items-center gap-5 py-6">
			{/* Sigma avatar preview */}
			<div className="relative">
				<div className="size-20 rounded-full overflow-hidden ring-2 ring-offset-2 ring-offset-background ring-primary/50">
					{identityKey ? (
						<Avatar
							name={identityKey}
							variant="pixel"
							size={80}
							colors={THEME_COLORS}
							className="rounded-full"
						/>
					) : (
						<div className="size-full bg-muted flex items-center justify-center">
							<User className="size-8 text-muted-foreground" />
						</div>
					)}
				</div>
				{/* Color accent dot */}
				<div
					className={`absolute -bottom-1 -right-1 size-6 rounded-full ${colorOption.bg} ring-2 ring-background`}
				/>
			</div>

			{/* Display name preview */}
			{displayName.trim() && (
				<p className="text-sm font-semibold text-foreground -mb-2">
					{displayName}
				</p>
			)}

			{/* BAP ID badge */}
			{bapId && (
				<Badge
					variant="outline"
					className="font-mono text-[10px] max-w-xs truncate"
				>
					BAP: {bapId.slice(0, 16)}...
				</Badge>
			)}

			<Separator className="w-full" />

			{/* Name input */}
			<div className="w-full max-w-xs space-y-2">
				<Label htmlFor="profile-display-name">Display name</Label>
				<Input
					id="profile-display-name"
					autoFocus
					placeholder="Enter your name"
					value={displayName}
					onChange={(e) => setDisplayName(e.target.value)}
					onKeyDown={(e) => {
						if (e.key === 'Enter' && displayName.trim()) handleSave()
					}}
				/>
			</div>

			{/* Color picker */}
			<div className="w-full max-w-xs space-y-2">
				<Label>Pick a color</Label>
				<div className="flex flex-wrap gap-2">
					{COLOR_OPTIONS.map((color) => (
						<button
							key={color.name}
							type="button"
							onClick={() => setSelectedColor(color.name)}
							className={`size-9 rounded-full ${color.bg} transition-all ${
								selectedColor === color.name
									? `ring-2 ${color.ring} ring-offset-2 ring-offset-background scale-110`
									: 'hover:scale-105'
							}`}
						/>
					))}
				</div>
			</div>

			{/* Actions */}
			<div className="flex w-full justify-between pt-2">
				<Button variant="ghost" size="sm" onClick={onAdvance}>
					Skip
					<SkipForward className="size-3.5" />
				</Button>
				<Button
					size="sm"
					onClick={handleSave}
					disabled={!displayName.trim() || saving}
				>
					{saving ? (
						<>
							<Spinner className="size-3.5" />
							Saving...
						</>
					) : (
						'Next'
					)}
				</Button>
			</div>
		</div>
	)
}

// ---------------------------------------------------------------------------
// Step 2: Blockchain Data (Stack)
// ---------------------------------------------------------------------------

function StackStep({ onAdvance }: { onAdvance: () => void }) {
	const [loading, setLoading] = useState(true)
	const [running, setRunning] = useState(false)
	const [adminUrl, setAdminUrl] = useState('')
	const [autoAdvancing, setAutoAdvancing] = useState(false)
	const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
	const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

	const checkStatus = useCallback(async () => {
		try {
			const status = await rpc.request.getStackStatus()
			setRunning(status.running)
			setAdminUrl(status.url)
			return status.running
		} catch {
			setRunning(false)
			return false
		} finally {
			setLoading(false)
		}
	}, [])

	useEffect(() => {
		checkStatus().then((isRunning) => {
			if (isRunning) {
				setAutoAdvancing(true)
				timeoutRef.current = setTimeout(() => onAdvance(), 1500)
			}
		})
		return () => {
			if (timeoutRef.current) clearTimeout(timeoutRef.current)
			if (pollRef.current) clearInterval(pollRef.current)
		}
	}, [checkStatus, onAdvance])

	const startPolling = useCallback(() => {
		if (pollRef.current) return
		pollRef.current = setInterval(async () => {
			const isRunning = await checkStatus()
			if (isRunning) {
				if (pollRef.current) clearInterval(pollRef.current)
				pollRef.current = null
				setAutoAdvancing(true)
				timeoutRef.current = setTimeout(() => onAdvance(), 1500)
			}
		}, 3000)
	}, [checkStatus, onAdvance])

	const [waitingForStack, setWaitingForStack] = useState(false)

	const [stackError, setStackError] = useState<string | null>(null)

	const handleSetup = useCallback(async () => {
		setWaitingForStack(true)
		setStackError(null)

		// Wait for the stack to respond before opening the window
		let responded = false
		for (let i = 0; i < 20; i++) {
			try {
				const res = await fetch(adminUrl, {
					method: 'HEAD',
					signal: AbortSignal.timeout(2000),
				})
				if (res.ok) {
					responded = true
					break
				}
			} catch {
				// Stack not ready yet
			}
			await new Promise((r) => setTimeout(r, 1500))
		}
		setWaitingForStack(false)

		if (!responded) {
			setStackError('Stack failed to start. Check logs at ~/.1sat-wallet/logs/')
			return
		}

		rpc.request.openBrowserWindow({ url: adminUrl, title: '1Sat Stack Setup' })
		startPolling()
	}, [adminUrl, startPolling])

	if (loading) {
		return (
			<div className="flex flex-col items-center gap-4 py-8">
				<Spinner className="size-6" />
				<p className="text-sm text-muted-foreground">
					Checking stack status...
				</p>
			</div>
		)
	}

	// Running and healthy -- auto-advancing
	if (running) {
		return (
			<div className="flex flex-col items-center gap-4 py-8">
				<div className="flex size-12 items-center justify-center rounded-full bg-green-500/10">
					<CheckCircle2 className="size-6 text-green-500" />
				</div>
				<div className="text-center">
					<p className="text-sm font-medium text-foreground">
						Blockchain sync is ready
					</p>
					{autoAdvancing && (
						<p className="text-xs text-muted-foreground mt-1">Continuing...</p>
					)}
				</div>
			</div>
		)
	}

	// Not running
	return (
		<div className="flex flex-col items-center gap-4 py-6">
			<div className="flex size-12 items-center justify-center rounded-full bg-muted">
				<Server className="size-6 text-muted-foreground" />
			</div>
			<div className="text-center max-w-sm">
				<p className="text-sm font-medium text-foreground mb-1">
					Blockchain Data
				</p>
				<p className="text-xs text-muted-foreground">
					The 1Sat Stack syncs blockchain data locally. Without it, some
					features work in read-only mode.
				</p>
			</div>
			{stackError && (
				<div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
					{stackError}
				</div>
			)}
			<Button onClick={handleSetup} disabled={waitingForStack}>
				{waitingForStack ? (
					<>
						<Spinner className="size-3.5" />
						Starting stack...
					</>
				) : (
					<>
						Complete Setup
						<ExternalLink className="size-3.5" />
					</>
				)}
			</Button>
			<div className="flex w-full justify-end pt-2">
				<Button variant="ghost" size="sm" onClick={onAdvance}>
					Skip
					<SkipForward className="size-3.5" />
				</Button>
			</div>
		</div>
	)
}

// ---------------------------------------------------------------------------
// Step 3: AI Assistant (Optional)
// ---------------------------------------------------------------------------

function AiStep({ onAdvance }: { onAdvance: () => void }) {
	const [loading, setLoading] = useState(true)
	const [available, setAvailable] = useState(false)
	const [models, setModels] = useState<string[]>([])
	const [selectedModel, setSelectedModel] = useState<string>('')
	const [detectedProvider, setDetectedProvider] = useState<AiProvider>('ollama')
	const [selectedProvider, setSelectedProvider] = useState<AiProvider>('ollama')

	const detect = useCallback(async (providerOverride?: AiProvider) => {
		setLoading(true)
		setAvailable(false)
		setModels([])

		const tryProvider = async (provider: AiProvider): Promise<boolean> => {
			const baseUrl = PROVIDER_DEFAULTS[provider].baseUrl.replace(
				/\/v1\/?$/,
				'',
			)
			try {
				const res = await rpc.request.checkAiProvider({ baseUrl })
				if (res.available && res.models.length > 0) {
					setAvailable(true)
					setModels(res.models)
					setSelectedModel(res.models[0])
					setDetectedProvider(provider)
					setSelectedProvider(provider)
					return true
				}
			} catch {
				/* continue */
			}
			return false
		}

		// If a specific provider was requested, try only that one
		if (providerOverride) {
			await tryProvider(providerOverride)
			setLoading(false)
			return
		}

		// Auto-detect: try all local providers
		for (const provider of LOCAL_PROVIDERS) {
			if (await tryProvider(provider)) {
				setLoading(false)
				return
			}
		}

		setLoading(false)
	}, [])

	useEffect(() => {
		detect()
	}, [detect])

	const handleProviderChange = useCallback(
		(provider: AiProvider) => {
			setSelectedProvider(provider)
			detect(provider)
		},
		[detect],
	)

	const handleSave = useCallback(() => {
		const settings = {
			provider: selectedProvider,
			baseUrl: PROVIDER_DEFAULTS[selectedProvider].baseUrl,
			apiKey: '',
			model: selectedModel,
		}
		localStorage.setItem(AI_SETTINGS_KEY, JSON.stringify(settings))
		onAdvance()
	}, [selectedProvider, selectedModel, onAdvance])

	// Provider selector (shown in all states)
	const providerSelector = (
		<div className="w-full max-w-xs space-y-2">
			<Label>AI Provider</Label>
			<Select
				value={selectedProvider}
				onValueChange={(v) => handleProviderChange(v as AiProvider)}
			>
				<SelectTrigger className="w-full">
					<SelectValue />
				</SelectTrigger>
				<SelectContent>
					{LOCAL_PROVIDERS.map((key) => (
						<SelectItem key={key} value={key}>
							{PROVIDER_DEFAULTS[key].label}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
		</div>
	)

	if (loading) {
		return (
			<div className="flex flex-col items-center gap-4 py-8">
				<Spinner className="size-6" />
				<p className="text-sm text-muted-foreground">
					Detecting AI provider...
				</p>
			</div>
		)
	}

	if (available && models.length > 0) {
		return (
			<div className="flex flex-col items-center gap-4 py-6">
				<div className="flex size-12 items-center justify-center rounded-full bg-green-500/10">
					<Sparkles className="size-6 text-green-500" />
				</div>
				<div className="text-center">
					<p className="text-sm font-medium text-foreground">
						{PROVIDER_DEFAULTS[detectedProvider].label} detected
					</p>
					<p className="text-xs text-muted-foreground mt-0.5">
						{models.length} model{models.length !== 1 ? 's' : ''} available
					</p>
				</div>
				{providerSelector}
				<div className="w-full max-w-xs space-y-2">
					<Label>Select a model</Label>
					<Select value={selectedModel} onValueChange={setSelectedModel}>
						<SelectTrigger className="w-full">
							<SelectValue placeholder="Choose model" />
						</SelectTrigger>
						<SelectContent>
							{models.map((m) => (
								<SelectItem key={m} value={m}>
									{m}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>
				<div className="flex w-full justify-between pt-2">
					<Button variant="ghost" size="sm" onClick={onAdvance}>
						Skip
						<SkipForward className="size-3.5" />
					</Button>
					<Button size="sm" onClick={handleSave} disabled={!selectedModel}>
						Next
					</Button>
				</div>
			</div>
		)
	}

	// Not available
	return (
		<div className="flex flex-col items-center gap-4 py-6">
			<div className="flex size-12 items-center justify-center rounded-full bg-muted">
				<Sparkles className="size-6 text-muted-foreground" />
			</div>
			<div className="text-center max-w-sm">
				<p className="text-sm font-medium text-foreground mb-1">AI Assistant</p>
				<p className="text-xs text-muted-foreground">
					Local AI via Ollama or LM Studio enables chat and page summarization.
				</p>
			</div>
			{providerSelector}
			<div className="flex items-center gap-2">
				<Button
					variant="outline"
					size="sm"
					onClick={() => detect(selectedProvider)}
				>
					<RefreshCw className="size-3.5" />
					Retry Detection
				</Button>
			</div>
			<div className="flex w-full justify-between pt-2">
				<Button variant="ghost" size="sm" onClick={onAdvance}>
					Skip
					<SkipForward className="size-3.5" />
				</Button>
				<Button size="sm" onClick={onAdvance}>
					Next
				</Button>
			</div>
		</div>
	)
}

// ---------------------------------------------------------------------------
// Step 4: Appearance
// ---------------------------------------------------------------------------

const APPEARANCE_OPTIONS: {
	value: AppearanceMode
	label: string
	icon: typeof Sun
	description: string
}[] = [
	{
		value: 'light',
		label: 'Light',
		icon: Sun,
		description: 'Always use light mode',
	},
	{
		value: 'dark',
		label: 'Dark',
		icon: Moon,
		description: 'Always use dark mode',
	},
	{
		value: 'system',
		label: 'System',
		icon: Monitor,
		description: 'Follow your OS preference',
	},
]

function AppearanceStep({ onComplete }: { onComplete: () => void }) {
	const [accountId, setAccountId] = useState<string | undefined>()
	useEffect(() => {
		rpc.request
			.getActiveAccount()
			.then((r) => {
				if (r.account) setAccountId(r.account.id)
			})
			.catch(() => {})
	}, [])
	const { mode, setMode } = useAppearance(accountId)

	useHotkeys([
		{
			hotkey: 'Enter',
			callback: () => {
				onComplete()
			},
		},
	])

	return (
		<div className="flex flex-col items-center gap-5 py-6">
			<div className="flex size-12 items-center justify-center rounded-full bg-muted">
				<Palette className="size-6 text-muted-foreground" />
			</div>
			<div className="text-center">
				<p className="text-sm font-medium text-foreground mb-1">Appearance</p>
				<p className="text-xs text-muted-foreground">
					Choose your preferred theme. You can change this anytime in Settings.
				</p>
			</div>

			<div className="w-full space-y-2">
				{APPEARANCE_OPTIONS.map((option) => {
					const Icon = option.icon
					const isSelected = mode === option.value
					return (
						<button
							key={option.value}
							type="button"
							onClick={() => setMode(option.value)}
							className={`w-full flex items-center gap-3 rounded-lg border px-4 py-3 transition-all text-left ${
								isSelected
									? 'border-primary bg-primary/5 ring-1 ring-primary/20'
									: 'border-border hover:border-muted-foreground/30'
							}`}
						>
							<Icon
								className={`size-5 shrink-0 ${
									isSelected ? 'text-primary' : 'text-muted-foreground'
								}`}
							/>
							<div className="flex-1 min-w-0">
								<p
									className={`text-sm font-medium ${
										isSelected ? 'text-foreground' : 'text-foreground'
									}`}
								>
									{option.label}
								</p>
								<p className="text-xs text-muted-foreground">
									{option.description}
								</p>
							</div>
							{isSelected && (
								<CheckCircle2 className="size-4 text-primary shrink-0" />
							)}
						</button>
					)
				})}
			</div>

			<Separator className="w-full" />

			<Button size="lg" className="w-full" onClick={onComplete}>
				Get Started
			</Button>
		</div>
	)
}
