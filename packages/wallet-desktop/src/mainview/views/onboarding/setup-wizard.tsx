import { useCallback, useEffect, useRef, useState } from 'react'
import {
	CheckCircle2,
	ExternalLink,
	Server,
	SkipForward,
	Sparkles,
	UserCircle2,
} from 'lucide-react'
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
import { StepIndicator, type Step } from '@/components/ui/step-indicator'
import { rpc } from '../../rpc'

const AI_SETTINGS_KEY = '1sat-ai-settings'

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

	const stepLabels = ['Stack', 'AI', 'Identity', 'Ready']

	const steps: Step[] = stepLabels.map((label, i) => ({
		id: String(i),
		label,
		status: i < currentStep ? 'complete' : i === currentStep ? 'active' : 'pending',
	}))

	const advance = useCallback(() => {
		setCurrentStep((s) => Math.min(s + 1, 3))
	}, [])

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
						{currentStep === 0 && (
							<StackStep
								onAdvance={(status) => {
									setResult((r) => ({ ...r, stack: status }))
									advance()
								}}
							/>
						)}
						{currentStep === 1 && (
							<AiStep
								onAdvance={(model) => {
									setResult((r) => ({ ...r, ai: model }))
									advance()
								}}
							/>
						)}
						{currentStep === 2 && (
							<IdentityStep
								onAdvance={(status) => {
									setResult((r) => ({ ...r, identity: status }))
									advance()
								}}
							/>
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
				const t = setTimeout(() => onAdvance('running'), 1500)
				return () => clearTimeout(t)
			}
		})
		return () => {
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
				setTimeout(() => onAdvance('running'), 1500)
			}
		}, 3000)
	}, [checkStatus, onAdvance])

	const handleSetup = useCallback(() => {
		rpc.request.openBrowserWindow({ url: adminUrl, title: '1Sat Stack Setup' })
		startPolling()
	}, [adminUrl, startPolling])

	if (loading) {
		return (
			<div className="flex flex-col items-center gap-4 py-8">
				<Spinner className="size-6" />
				<p className="text-sm text-muted-foreground">Checking stack status...</p>
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
						<p className="text-xs text-muted-foreground mt-1">
							Continuing...
						</p>
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
			{adminUrl && (
				<Button onClick={handleSetup}>
					Complete Setup
					<ExternalLink className="size-3.5" />
				</Button>
			)}
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

function AiStep({
	onAdvance,
}: { onAdvance: (model: string | null) => void }) {
	const [loading, setLoading] = useState(true)
	const [available, setAvailable] = useState(false)
	const [models, setModels] = useState<string[]>([])
	const [selectedModel, setSelectedModel] = useState<string>('')

	useEffect(() => {
		rpc.request
			.checkAiProvider({})
			.then((res) => {
				setAvailable(res.available)
				setModels(res.models)
				if (res.models.length > 0) {
					setSelectedModel(res.models[0])
				}
			})
			.catch(() => {
				setAvailable(false)
			})
			.finally(() => setLoading(false))
	}, [])

	const handleSave = useCallback(() => {
		const settings = {
			provider: 'ollama',
			baseUrl: 'http://localhost:11434/v1',
			model: selectedModel,
		}
		localStorage.setItem(AI_SETTINGS_KEY, JSON.stringify(settings))
		onAdvance(selectedModel)
	}, [selectedModel, onAdvance])

	if (loading) {
		return (
			<div className="flex flex-col items-center gap-4 py-8">
				<Spinner className="size-6" />
				<p className="text-sm text-muted-foreground">Detecting AI provider...</p>
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
					<p className="text-sm font-medium text-foreground">Ollama detected</p>
					<p className="text-xs text-muted-foreground mt-0.5">
						{models.length} model{models.length !== 1 ? 's' : ''} available
					</p>
				</div>
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
					<Button
						variant="ghost"
						size="sm"
						onClick={() => onAdvance(null)}
					>
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
				<p className="text-sm font-medium text-foreground mb-1">
					AI Assistant
				</p>
				<p className="text-xs text-muted-foreground">
					Local AI via Ollama enables chat and page summarization.
				</p>
			</div>
			<Button
				variant="outline"
				size="sm"
				onClick={() =>
					rpc.request.openBrowserWindow({
						url: 'https://ollama.com',
						title: 'Install Ollama',
					})
				}
			>
				Install Ollama
				<ExternalLink className="size-3.5" />
			</Button>
			<div className="flex w-full justify-between pt-2">
				<Button
					variant="ghost"
					size="sm"
					onClick={() => onAdvance(null)}
				>
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

	useEffect(() => {
		Promise.all([rpc.request.getBalance(), rpc.request.getIdentity()])
			.then(([bal, identity]) => {
				setBalance(bal.confirmed + bal.unconfirmed)
				setBapId(identity.bapId)
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
				setTimeout(() => onAdvance('published'), 1500)
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

	// Already published
	if (bapId) {
		return (
			<div className="flex flex-col items-center gap-4 py-8">
				<div className="flex size-12 items-center justify-center rounded-full bg-green-500/10">
					<CheckCircle2 className="size-6 text-green-500" />
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
				<div className="flex size-12 items-center justify-center rounded-full bg-muted">
					<UserCircle2 className="size-6 text-muted-foreground" />
				</div>
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
				{error && (
					<p className="text-xs text-destructive">{error}</p>
				)}
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
			<div className="flex size-12 items-center justify-center rounded-full bg-muted">
				<UserCircle2 className="size-6 text-muted-foreground" />
			</div>
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
						{item.done && <CheckCircle2 className="size-3.5 text-green-500 shrink-0" />}
					</div>
				))}
			</div>
			<Button size="lg" className="w-full" onClick={onComplete}>
				Get Started
			</Button>
		</div>
	)
}
