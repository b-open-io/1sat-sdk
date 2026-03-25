import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { type Step, StepIndicator } from '@/components/ui/step-indicator'
import {
	CheckCircle2,
	ExternalLink,
	RefreshCw,
	Server,
	SkipForward,
	Sparkles,
	UserCircle2,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { rpc } from '../../rpc'

import {
	AI_SETTINGS_KEY,
	type AiProvider,
	LOCAL_PROVIDERS,
	PROVIDER_DEFAULTS,
} from '../../../shared/ai-providers'
const STEP_LABELS = ['Stack', 'AI', 'Identity', 'Ready'] as const

interface StepResult {
	stack: 'running' | 'skipped'
	ai: string | null // model name or null if skipped
	identity: 'published' | 'skipped'
}

export function SetupWizard({ onComplete }: { onComplete: () => void }) {
	const [currentStep, setCurrentStep] = useState(0)
	const [result, setResult] = useState<StepResult>({
		stack: 'skipped',
		ai: null,
		identity: 'skipped',
	})

	const advance = useCallback(() => {
		setCurrentStep((s) => Math.min(s + 1, 3))
	}, [])

	const handleStackAdvance = useCallback(
		(status: 'running' | 'skipped') => {
			setResult((r) => ({ ...r, stack: status }))
			advance()
		},
		[advance],
	)

	const handleAiAdvance = useCallback(
		(model: string | null) => {
			setResult((r) => ({ ...r, ai: model }))
			advance()
		},
		[advance],
	)

	const handleIdentityAdvance = useCallback(
		(status: 'published' | 'skipped') => {
			setResult((r) => ({ ...r, identity: status }))
			advance()
		},
		[advance],
	)

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

				<StepIndicator steps={steps} className="mb-8 justify-center" />

				<Card>
					<CardContent>
						{currentStep === 0 && <StackStep onAdvance={handleStackAdvance} />}
						{currentStep === 1 && <AiStep onAdvance={handleAiAdvance} />}
						{currentStep === 2 && (
							<IdentityStep onAdvance={handleIdentityAdvance} />
						)}
						{currentStep === 3 && (
							<ReadyStep result={result} onComplete={onComplete} />
						)}
					</CardContent>
				</Card>
			</div>
		</div>
	)
}

// ---------------------------------------------------------------------------
// Step 1: Blockchain Data (Stack)
// ---------------------------------------------------------------------------

function StackStep({
	onAdvance,
}: { onAdvance: (status: 'running' | 'skipped') => void }) {
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
				timeoutRef.current = setTimeout(() => onAdvance('running'), 1500)
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
				timeoutRef.current = setTimeout(() => onAdvance('running'), 1500)
			}
		}, 3000)
	}, [checkStatus, onAdvance])

	const [waitingForStack, setWaitingForStack] = useState(false)

	const handleSetup = useCallback(async () => {
		setWaitingForStack(true)
		// Wait for the stack to actually respond before opening the window
		const maxAttempts = 20
		for (let i = 0; i < maxAttempts; i++) {
			try {
				const res = await fetch(adminUrl, { method: 'HEAD', signal: AbortSignal.timeout(2000) })
				if (res.ok) break
			} catch {
				// Stack not ready yet
			}
			await new Promise((r) => setTimeout(r, 1500))
		}
		setWaitingForStack(false)
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
				<Button variant="ghost" size="sm" onClick={() => onAdvance('skipped')}>
					Skip
					<SkipForward className="size-3.5" />
				</Button>
			</div>
		</div>
	)
}

// ---------------------------------------------------------------------------
// Step 2: AI Assistant (Optional)
// ---------------------------------------------------------------------------

function AiStep({ onAdvance }: { onAdvance: (model: string | null) => void }) {
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
		onAdvance(selectedModel)
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
					<Button variant="ghost" size="sm" onClick={() => onAdvance(null)}>
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
				<Button variant="ghost" size="sm" onClick={() => onAdvance(null)}>
					Skip
					<SkipForward className="size-3.5" />
				</Button>
				<Button size="sm" onClick={() => onAdvance(null)}>
					Next
				</Button>
			</div>
		</div>
	)
}

// ---------------------------------------------------------------------------
// Step 3: Identity (Optional)
// ---------------------------------------------------------------------------

function IdentityStep({
	onAdvance,
}: { onAdvance: (status: 'published' | 'skipped') => void }) {
	const [loading, setLoading] = useState(true)
	const [balance, setBalance] = useState(0)
	const [bapId, setBapId] = useState<string | null>(null)
	const [publishing, setPublishing] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const [displayName, setDisplayName] = useState('')
	const [accountColor, setAccountColor] = useState('blue')
	const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

	useEffect(() => {
		return () => {
			if (timeoutRef.current) clearTimeout(timeoutRef.current)
		}
	}, [])

	useEffect(() => {
		Promise.all([
			rpc.request.getBalance(),
			rpc.request.getIdentity(),
			rpc.request.getActiveAccount().catch(() => ({ account: null })),
		])
			.then(([bal, identity, active]) => {
				setBalance(bal.confirmed + bal.unconfirmed)
				setBapId(identity.bapId)
				if (active.account) {
					if (active.account.displayName)
						setDisplayName(active.account.displayName)
					if (active.account.color) setAccountColor(active.account.color)
				}
			})
			.catch(() => {
				// leave defaults
			})
			.finally(() => setLoading(false))
	}, [])

	const handlePublish = useCallback(async () => {
		setPublishing(true)
		setError(null)
		try {
			const res = await rpc.request.publishIdentity()
			if (res.error) {
				setError(res.error)
			} else {
				setBapId(res.bapId ?? null)
				timeoutRef.current = setTimeout(() => onAdvance('published'), 1500)
			}
		} catch (err) {
			setError(String(err))
		} finally {
			setPublishing(false)
		}
	}, [onAdvance])

	if (loading) {
		return (
			<div className="flex flex-col items-center gap-4 py-8">
				<Spinner className="size-6" />
				<p className="text-sm text-muted-foreground">Loading identity...</p>
			</div>
		)
	}

	// Account avatar helper
	const accountInitials = displayName
		? displayName
				.split(/\s+/)
				.slice(0, 2)
				.map((w) => w[0]?.toUpperCase() ?? '')
				.join('')
		: '?'

	const avatarNode = (
		<div
			className={`flex size-14 items-center justify-center rounded-full bg-${accountColor}-500 text-white text-lg font-bold`}
		>
			{accountInitials}
		</div>
	)

	// Already published
	if (bapId) {
		return (
			<div className="flex flex-col items-center gap-4 py-8">
				{avatarNode}
				{displayName && (
					<p className="text-sm font-semibold text-foreground -mb-2">
						{displayName}
					</p>
				)}
				<div className="flex size-8 items-center justify-center rounded-full bg-green-500/10 -mt-1">
					<CheckCircle2 className="size-4 text-green-500" />
				</div>
				<div className="text-center">
					<p className="text-sm font-medium text-foreground">
						Identity published
					</p>
					<p className="text-xs text-muted-foreground mt-0.5 font-mono truncate max-w-xs">
						{bapId}
					</p>
				</div>
			</div>
		)
	}

	// Has balance, can publish
	if (balance > 0) {
		return (
			<div className="flex flex-col items-center gap-4 py-6">
				{avatarNode}
				{displayName && (
					<p className="text-sm font-semibold text-foreground -mb-2">
						{displayName}
					</p>
				)}
				<div className="text-center">
					<p className="text-sm font-medium text-foreground mb-1">
						Publish your identity on-chain?
					</p>
					<p className="text-xs text-muted-foreground">
						Creates a BAP identity attestation on the blockchain.
					</p>
				</div>
				<div className="w-full max-w-xs space-y-2">
					<Label htmlFor="display-name">Display Name</Label>
					<Input
						id="display-name"
						placeholder="Enter a display name"
						value={displayName}
						onChange={(e) => setDisplayName(e.target.value)}
					/>
				</div>
				{error && <p className="text-xs text-destructive">{error}</p>}
				<div className="flex w-full justify-between pt-2">
					<Button
						variant="ghost"
						size="sm"
						onClick={() => onAdvance('skipped')}
					>
						Skip
						<SkipForward className="size-3.5" />
					</Button>
					<Button size="sm" onClick={handlePublish} disabled={publishing}>
						{publishing && <Spinner className="size-3.5" />}
						Publish
					</Button>
				</div>
			</div>
		)
	}

	// Zero balance
	return (
		<div className="flex flex-col items-center gap-4 py-6">
			{avatarNode}
			{displayName && (
				<p className="text-sm font-semibold text-foreground -mb-2">
					{displayName}
				</p>
			)}
			<div className="text-center max-w-sm">
				<p className="text-sm font-medium text-foreground mb-1">Identity</p>
				<p className="text-xs text-muted-foreground">
					You'll need BSV to publish your identity. You can do this later in
					Settings.
				</p>
			</div>
			<div className="flex w-full justify-end pt-2">
				<Button variant="ghost" size="sm" onClick={() => onAdvance('skipped')}>
					Skip
					<SkipForward className="size-3.5" />
				</Button>
			</div>
		</div>
	)
}

// ---------------------------------------------------------------------------
// Step 4: Ready
// ---------------------------------------------------------------------------

function ReadyStep({
	result,
	onComplete,
}: { result: StepResult; onComplete: () => void }) {
	const items = [
		{
			label: 'Stack',
			icon: Server,
			value: result.stack === 'running' ? 'Running' : 'Skipped',
			done: result.stack === 'running',
		},
		{
			label: 'AI',
			icon: Sparkles,
			value: result.ai ?? 'Skipped',
			done: result.ai !== null,
		},
		{
			label: 'Identity',
			icon: UserCircle2,
			value: result.identity === 'published' ? 'Published' : 'Skipped',
			done: result.identity === 'published',
		},
	]

	return (
		<div className="flex flex-col items-center gap-6 py-6">
			<div className="flex size-12 items-center justify-center rounded-full bg-green-500/10">
				<CheckCircle2 className="size-6 text-green-500" />
			</div>
			<div className="text-center">
				<p className="text-sm font-medium text-foreground">You're all set</p>
				<p className="text-xs text-muted-foreground mt-0.5">
					You can change any of these in Settings later.
				</p>
			</div>
			<div className="w-full space-y-3">
				{items.map((item) => (
					<div
						key={item.label}
						className="flex items-center gap-3 rounded-md border px-3 py-2"
					>
						<item.icon className="size-4 text-muted-foreground shrink-0" />
						<span className="text-sm text-foreground flex-1">{item.label}</span>
						<span
							className={
								item.done
									? 'text-xs text-green-500 font-medium'
									: 'text-xs text-muted-foreground'
							}
						>
							{item.value}
						</span>
						{item.done && (
							<CheckCircle2 className="size-3.5 text-green-500 shrink-0" />
						)}
					</div>
				))}
			</div>
			<Button size="lg" className="w-full" onClick={onComplete}>
				Get Started
			</Button>
		</div>
	)
}
