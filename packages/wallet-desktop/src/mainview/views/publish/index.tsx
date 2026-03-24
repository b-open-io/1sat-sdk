import { cn } from '@/lib/utils'
import {
	AlertCircle,
	AlertTriangle,
	ArrowLeft,
	ArrowRight,
	Check,
	ChevronRight,
	Clipboard,
	ExternalLink,
	FileCode,
	FileCog,
	FileImage,
	FileJson,
	FileText,
	Folder,
	FolderUp,
	Info,
	RefreshCw,
	Rocket,
	Share2,
	Wallet,
	X,
} from 'lucide-react'
import React, { useCallback, useEffect, useRef, useState } from 'react'
import type { OpnsNameInfo } from '../../../shared/types'
import { Button } from '../../components/ui/button'
import { rpc } from '../../rpc'

// ─── Types ────────────────────────────────────────────────────────────────────

type WizardStep = 'select' | 'build' | 'configure' | 'publish'

/** Sub-states within the publish step */
type PublishSubState = 'review' | 'insufficient' | 'broadcasting' | 'success'

type ProjectType = 'Vite' | 'CRA' | 'Bot' | 'Skill' | 'Static'

interface RecentProject {
	name: string
	path: string
	type: ProjectType
}

interface BuildFile {
	name: string
	mime: string
	sizeKb: number
}

interface ConfigureFormData {
	appName: string
	description: string
	opnsName: string
	identity: string
	permissions: string[]
}

// ─── Constants ───────────────────────────────────────────────────────────────

const SAT_PER_BSV = 100_000_000

const RECENT_PROJECTS_KEY = '1sat-publish-recent'

const DEFAULT_RECENT: RecentProject[] = [
	{ name: 'bitbattle-arena', path: '~/code/bitbattle-arena', type: 'Vite' },
	{ name: 'ordinal-gallery', path: '~/code/ordinal-gallery', type: 'CRA' },
	{ name: 'research-agent', path: '~/code/research-agent', type: 'Bot' },
	{
		name: 'bsv-pricing-skill',
		path: '~/code/bsv-pricing-skill',
		type: 'Skill',
	},
]

// Placeholder: these will be populated by a real file system build step once
// native project scanning is implemented. For now the wizard UI needs
// something to display in the build output table.
const MOCK_BUILD_FILES: BuildFile[] = [
	{ name: 'index.html', mime: 'text/html', sizeKb: 2.1 },
	{ name: 'index-Da4x.js', mime: 'text/javascript', sizeKb: 98.4 },
	{ name: 'index-Bk2m.css', mime: 'text/css', sizeKb: 38.7 },
	{ name: 'favicon.svg', mime: 'image/svg+xml', sizeKb: 2.8 },
]

// Placeholder: real build error output will come from the native build
// process once file system integration is wired up.
const MOCK_BUILD_ERROR_LOG = `$ bun run build
vite v6.0.3 building for production...
transforming (1247 modules)...

ERROR  src/App.tsx:42:18
  Property 'wallet' does not exist on type
  'IntrinsicAttributes & Props'

ERROR  src/components/Game.tsx:89:5
  Cannot find module './assets/sprite.png'`

const DEFAULT_PERMISSIONS = ['getPublicKey', 'createAction']

// Cost estimate constants — real fee estimation would need actual data size
const COST_INSCRIPTION = 0.00142
const COST_MAP = 0.00001
const COST_AIP = 0.00001
const COST_MINER = 0.00003
const COST_TOTAL = COST_INSCRIPTION + COST_MAP + COST_AIP + COST_MINER

// ─── Step indicator ───────────────────────────────────────────────────────────

const STEPS: { id: WizardStep; label: string; number: number }[] = [
	{ id: 'select', label: 'Select', number: 1 },
	{ id: 'build', label: 'Build', number: 2 },
	{ id: 'configure', label: 'Configure', number: 3 },
	{ id: 'publish', label: 'Publish', number: 4 },
]

type StepStatus = 'complete' | 'active' | 'error' | 'pending' | 'warning'

interface PublishStepIndicatorProps {
	current: WizardStep
	buildFailed?: boolean
	publishSubState?: PublishSubState
}

function PublishStepIndicator({
	current,
	buildFailed,
	publishSubState,
}: PublishStepIndicatorProps) {
	const currentIndex = STEPS.findIndex((s) => s.id === current)
	const allComplete =
		publishSubState === 'broadcasting' || publishSubState === 'success'

	return (
		<div className="flex items-center gap-0 px-6 py-4 border-b border-border">
			{STEPS.map((step, idx) => {
				let status: StepStatus
				if (allComplete) {
					status = 'complete'
				} else if (idx < currentIndex) {
					status = step.id === 'build' && buildFailed ? 'error' : 'complete'
				} else if (idx === currentIndex) {
					if (step.id === 'build' && buildFailed) {
						status = 'error'
					} else if (
						step.id === 'publish' &&
						publishSubState === 'insufficient'
					) {
						status = 'warning'
					} else {
						status = 'active'
					}
				} else {
					status = 'pending'
				}

				return (
					<React.Fragment key={step.id}>
						<div className="flex items-center gap-2">
							<div
								className={cn(
									'w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold shrink-0 transition-colors',
									status === 'complete' &&
										'bg-emerald-500/20 text-emerald-400 ring-1 ring-emerald-500/40',
									status === 'active' &&
										'bg-blue-500 text-white shadow-sm shadow-blue-500/30',
									status === 'error' &&
										'bg-red-500/20 text-red-400 ring-1 ring-red-500/40',
									status === 'warning' &&
										'bg-amber-500/20 text-amber-400 ring-1 ring-amber-500/40',
									status === 'pending' && 'bg-muted text-muted-foreground',
								)}
							>
								{status === 'complete' ? (
									<Check size={14} strokeWidth={2.5} aria-label="Complete" />
								) : status === 'error' ? (
									<X size={14} strokeWidth={2.5} aria-label="Error" />
								) : status === 'warning' ? (
									<AlertTriangle
										size={13}
										strokeWidth={2.5}
										aria-label="Warning"
									/>
								) : (
									<span>{step.number}</span>
								)}
							</div>
							<span
								className={cn(
									'text-sm font-medium',
									status === 'active' && 'text-foreground font-semibold',
									(status === 'pending' || status === 'complete') &&
										'text-muted-foreground',
									status === 'error' && 'text-red-400',
									status === 'warning' && 'text-amber-400 font-semibold',
								)}
							>
								{step.label}
							</span>
						</div>
						{idx < STEPS.length - 1 && (
							<ChevronRight
								size={14}
								className="text-muted-foreground/40 mx-3 shrink-0"
							/>
						)}
					</React.Fragment>
				)
			})}
		</div>
	)
}

// ─── Project type badge ───────────────────────────────────────────────────────

const TYPE_COLORS: Record<ProjectType, string> = {
	Vite: 'bg-blue-500/20 text-blue-300 ring-1 ring-blue-500/30',
	CRA: 'bg-zinc-500/20 text-zinc-300 ring-1 ring-zinc-500/30',
	Bot: 'bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-500/30',
	Skill: 'bg-purple-500/20 text-purple-300 ring-1 ring-purple-500/30',
	Static: 'bg-amber-500/20 text-amber-300 ring-1 ring-amber-500/30',
}

const FOLDER_COLORS: Record<ProjectType, string> = {
	Vite: 'text-blue-400',
	CRA: 'text-zinc-400',
	Bot: 'text-emerald-400',
	Skill: 'text-purple-400',
	Static: 'text-amber-400',
}

function TypeBadge({ type }: { type: ProjectType }) {
	return (
		<span
			className={cn(
				'inline-flex items-center px-2 py-0.5 rounded text-xs font-mono font-medium shrink-0',
				TYPE_COLORS[type],
			)}
		>
			{type}
		</span>
	)
}

// ─── File type icon ───────────────────────────────────────────────────────────

function FileTypeIcon({ mime, name }: { mime: string; name: string }) {
	if (mime.includes('html'))
		return <FileCode size={15} className="text-blue-400" />
	if (mime.includes('javascript'))
		return <FileJson size={15} className="text-yellow-400" />
	if (mime.includes('css'))
		return <FileCog size={15} className="text-purple-400" />
	if (mime.includes('svg') || mime.includes('image'))
		return <FileImage size={15} className="text-emerald-400" />
	if (name.endsWith('.json'))
		return <FileJson size={15} className="text-orange-400" />
	return <FileText size={15} className="text-muted-foreground" />
}

// ─── Tooltip icon ─────────────────────────────────────────────────────────────

function TooltipIcon({ label }: { label: string }) {
	return (
		<span
			title={label}
			className="inline-flex items-center text-muted-foreground/50 cursor-help"
		>
			<Info size={13} strokeWidth={1.75} />
		</span>
	)
}

// ─── Step 1: Select ───────────────────────────────────────────────────────────

interface SelectStepProps {
	onSelect: (project: RecentProject) => void
}

function SelectStep({ onSelect }: SelectStepProps) {
	const [recentProjects, setRecentProjects] = useState<RecentProject[]>([])
	const [isDragging, setIsDragging] = useState(false)

	useEffect(() => {
		try {
			const stored = localStorage.getItem(RECENT_PROJECTS_KEY)
			if (stored) {
				const parsed = JSON.parse(stored) as RecentProject[]
				setRecentProjects(parsed)
			} else {
				setRecentProjects(DEFAULT_RECENT)
			}
		} catch {
			setRecentProjects(DEFAULT_RECENT)
		}
	}, [])

	const handleDropzoneClick = useCallback(() => {
		if (recentProjects.length > 0) {
			onSelect(recentProjects[0])
		}
	}, [recentProjects, onSelect])

	const handleDragOver = useCallback((e: React.DragEvent) => {
		e.preventDefault()
		setIsDragging(true)
	}, [])

	const handleDragLeave = useCallback(() => {
		setIsDragging(false)
	}, [])

	const handleDrop = useCallback(
		(e: React.DragEvent) => {
			e.preventDefault()
			setIsDragging(false)
			if (recentProjects.length > 0) {
				onSelect(recentProjects[0])
			}
		},
		[recentProjects, onSelect],
	)

	const handleRecentClick = useCallback(
		(project: RecentProject) => {
			onSelect(project)
		},
		[onSelect],
	)

	return (
		<div className="flex flex-col gap-5 p-6 flex-1 overflow-y-auto">
			{/* Dropzone */}
			<button
				type="button"
				aria-label="Select a project folder"
				onClick={handleDropzoneClick}
				onDragOver={handleDragOver}
				onDragLeave={handleDragLeave}
				onDrop={handleDrop}
				className={cn(
					'flex flex-col items-center justify-center gap-3 py-10 px-6',
					'border border-dashed cursor-pointer transition-colors select-none bg-transparent',
					isDragging
						? 'border-blue-500/60 bg-blue-500/5'
						: 'border-border hover:border-border/80 hover:bg-muted/30 bg-muted/10',
				)}
			>
				<FolderUp
					size={40}
					strokeWidth={1.25}
					className={cn(
						'transition-colors',
						isDragging ? 'text-blue-400' : 'text-muted-foreground',
					)}
				/>
				<div className="flex flex-col items-center gap-1">
					<p className="text-base font-medium text-foreground">
						Select a project folder
					</p>
					<p className="text-sm text-muted-foreground">
						Drag a folder here or click to browse
					</p>
				</div>
				<div className="flex items-center gap-1.5 px-3 py-1.5 bg-muted/60 border border-border text-xs text-muted-foreground font-mono">
					React&nbsp;&middot;&nbsp;Skill&nbsp;&middot;&nbsp;Bot&nbsp;&middot;&nbsp;Static
					Site&nbsp;&middot;&nbsp;Media
				</div>
			</button>

			{/* Recent projects */}
			{recentProjects.length > 0 && (
				<div className="flex flex-col gap-2">
					<p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground px-0.5">
						Recent Projects
					</p>
					<div className="flex flex-col border border-border divide-y divide-border">
						{recentProjects.map((project) => (
							<button
								key={project.path}
								type="button"
								onClick={() => handleRecentClick(project)}
								className="flex items-center gap-3 px-4 py-3 text-left hover:bg-muted/40 transition-colors group"
							>
								<Folder
									size={18}
									strokeWidth={1.5}
									className={cn(
										'shrink-0 transition-colors',
										FOLDER_COLORS[project.type],
									)}
								/>
								<div className="flex flex-col gap-0.5 flex-1 min-w-0">
									<span className="text-sm font-medium text-foreground leading-none">
										{project.name}
									</span>
									<span
										className="text-xs text-muted-foreground leading-none mt-1"
										style={{ fontFamily: 'var(--font-mono)' }}
									>
										{project.path}
									</span>
								</div>
								<TypeBadge type={project.type} />
							</button>
						))}
					</div>
				</div>
			)}
		</div>
	)
}

// ─── Step 2: Build ────────────────────────────────────────────────────────────

type BuildStatus = 'success' | 'error'

interface BuildStepProps {
	project: RecentProject
	onBack: () => void
	onNext: () => void
}

function BuildStep({ project, onBack, onNext }: BuildStepProps) {
	const buildStatus: BuildStatus = project.type === 'CRA' ? 'error' : 'success'
	const [retrying, setRetrying] = useState(false)

	const handleRetry = useCallback(() => {
		setRetrying(true)
		setTimeout(() => setRetrying(false), 2000)
	}, [])

	const totalSizeKb = MOCK_BUILD_FILES.reduce((sum, f) => sum + f.sizeKb, 0)
	const totalSizeDisplay =
		totalSizeKb >= 1000
			? `${(totalSizeKb / 1000).toFixed(1)} MB`
			: `${totalSizeKb.toFixed(1)} KB`

	return (
		<>
			<div className="flex flex-col gap-5 p-6 flex-1 overflow-y-auto">
				{buildStatus === 'success' ? (
					<div className="flex items-center gap-3 px-4 py-3 border border-emerald-500/30 bg-emerald-500/10 text-emerald-300">
						<Check size={15} strokeWidth={2.5} className="shrink-0" />
						<span className="text-sm font-medium">
							Build succeeded &mdash; {MOCK_BUILD_FILES.length} files,{' '}
							{totalSizeDisplay} total
						</span>
					</div>
				) : (
					<div className="flex items-center gap-3 px-4 py-3 border border-red-500/30 bg-red-500/10 text-red-400">
						<AlertCircle size={15} strokeWidth={2.5} className="shrink-0" />
						<span className="text-sm font-medium">
							Build failed with 2 errors
						</span>
					</div>
				)}

				{buildStatus === 'success' ? (
					<div className="flex flex-col gap-2">
						<p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
							Build Output
						</p>
						<div className="border border-border">
							<div className="flex items-center px-4 py-2 bg-muted/30 border-b border-border">
								<span className="flex-1 text-xs font-medium text-muted-foreground">
									File
								</span>
								<span
									className="w-32 text-right text-xs font-medium text-muted-foreground"
									style={{ fontFamily: 'var(--font-mono)' }}
								>
									Type
								</span>
								<span
									className="w-20 text-right text-xs font-medium text-muted-foreground"
									style={{ fontFamily: 'var(--font-mono)' }}
								>
									Size
								</span>
							</div>
							{MOCK_BUILD_FILES.map((file) => (
								<div
									key={file.name}
									className="flex items-center px-4 py-3 border-b border-border last:border-b-0 hover:bg-muted/20 transition-colors"
								>
									<div className="flex-1 flex items-center gap-2.5 min-w-0">
										<FileTypeIcon mime={file.mime} name={file.name} />
										<span
											className="text-sm text-foreground truncate"
											style={{ fontFamily: 'var(--font-mono)' }}
										>
											{file.name}
										</span>
									</div>
									<span
										className="w-32 text-right text-xs text-muted-foreground"
										style={{ fontFamily: 'var(--font-mono)' }}
									>
										{file.mime}
									</span>
									<span
										className="w-20 text-right text-sm text-foreground tabular-nums"
										style={{ fontFamily: 'var(--font-mono)' }}
									>
										{file.sizeKb.toFixed(1)} KB
									</span>
								</div>
							))}
						</div>
					</div>
				) : (
					<div className="flex flex-col gap-2">
						<p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
							Build Log
						</p>
						<div
							className="border border-border bg-card p-4 overflow-x-auto"
							style={{
								fontFamily: 'var(--font-mono)',
								fontSize: 12,
								lineHeight: 1.7,
							}}
						>
							{MOCK_BUILD_ERROR_LOG.split('\n').map((line, i) => {
								const isError =
									line.startsWith('ERROR') ||
									line.startsWith('  Property') ||
									line.startsWith('  Cannot')
								return (
									<div
										key={`line-${i}-${line.slice(0, 8)}`}
										className={cn(
											'whitespace-pre',
											isError ? 'text-red-400' : 'text-muted-foreground',
										)}
									>
										{line || '\u00a0'}
									</div>
								)
							})}
						</div>
					</div>
				)}
			</div>

			<div className="flex items-center justify-between px-6 py-4 border-t border-border shrink-0">
				<Button variant="outline" size="sm" onClick={onBack} className="gap-2">
					<ArrowLeft size={14} />
					Back
				</Button>
				{buildStatus === 'success' ? (
					<Button
						size="sm"
						onClick={onNext}
						className="gap-2 bg-blue-600 hover:bg-blue-700 text-white"
					>
						Configure
						<ArrowRight size={14} />
					</Button>
				) : (
					<Button
						size="sm"
						onClick={handleRetry}
						disabled={retrying}
						className="gap-2 bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-60"
					>
						<RefreshCw size={14} className={retrying ? 'animate-spin' : ''} />
						{retrying ? 'Building...' : 'Retry Build'}
					</Button>
				)}
			</div>
		</>
	)
}

// ─── Step 3: Configure ────────────────────────────────────────────────────────

interface ConfigureStepProps {
	project: RecentProject
	formData: ConfigureFormData
	identities: OpnsNameInfo[]
	identitiesLoading: boolean
	onChange: (data: ConfigureFormData) => void
	onBack: () => void
	onNext: () => void
}

function ConfigureStep({
	project,
	formData,
	identities,
	identitiesLoading,
	onChange,
	onBack,
	onNext,
}: ConfigureStepProps) {
	const [opnsStatus, setOpnsStatus] = useState<
		'idle' | 'checking' | 'available' | 'taken'
	>('idle')
	const [opnsTimer, setOpnsTimer] = useState<ReturnType<
		typeof setTimeout
	> | null>(null)

	const handleOpnsChange = useCallback(
		(value: string) => {
			onChange({ ...formData, opnsName: value })
			if (opnsTimer) clearTimeout(opnsTimer)
			if (!value.trim()) {
				setOpnsStatus('idle')
				return
			}
			setOpnsStatus('checking')
			const t = setTimeout(() => {
				// Mock: 'taken' if user types 'taken', otherwise available.
				setOpnsStatus(value.toLowerCase() === 'taken' ? 'taken' : 'available')
			}, 600)
			setOpnsTimer(t)
		},
		[formData, onChange, opnsTimer],
	)

	const handleRemovePermission = useCallback(
		(perm: string) => {
			onChange({
				...formData,
				permissions: formData.permissions.filter((p) => p !== perm),
			})
		},
		[formData, onChange],
	)

	const [addingPermission, setAddingPermission] = useState(false)
	const [newPermissionName, setNewPermissionName] = useState('')
	const permissionInputRef = useRef<HTMLInputElement>(null)

	const handleStartAddPermission = useCallback(() => {
		setAddingPermission(true)
		setNewPermissionName('')
		// Focus after render
		requestAnimationFrame(() => permissionInputRef.current?.focus())
	}, [])

	const handleConfirmPermission = useCallback(() => {
		const name = newPermissionName.trim()
		if (name && !formData.permissions.includes(name)) {
			onChange({
				...formData,
				permissions: [...formData.permissions, name],
			})
		}
		setAddingPermission(false)
		setNewPermissionName('')
	}, [newPermissionName, formData, onChange])

	const handleCancelPermission = useCallback(() => {
		setAddingPermission(false)
		setNewPermissionName('')
	}, [])

	const isValid = formData.appName.trim().length > 0

	return (
		<>
			<div className="flex flex-col gap-5 p-6 flex-1 overflow-y-auto">
				{/* App Name */}
				<div className="flex flex-col gap-1.5">
					<label
						htmlFor="cfg-app-name"
						className="text-sm font-medium text-foreground"
					>
						App Name
					</label>
					<input
						id="cfg-app-name"
						type="text"
						value={formData.appName}
						onChange={(e) => onChange({ ...formData, appName: e.target.value })}
						placeholder={project.name}
						className={cn(
							'w-full px-3 py-2 text-sm bg-card border border-border text-foreground',
							'placeholder:text-muted-foreground/50',
							'focus:outline-none focus:ring-1 focus:ring-blue-500/60 focus:border-blue-500/60',
							'transition-colors',
						)}
					/>
				</div>

				{/* Description */}
				<div className="flex flex-col gap-1.5">
					<label
						htmlFor="cfg-description"
						className="text-sm font-medium text-foreground"
					>
						Description
					</label>
					<input
						id="cfg-description"
						type="text"
						value={formData.description}
						onChange={(e) =>
							onChange({ ...formData, description: e.target.value })
						}
						placeholder="Short description of your app"
						className={cn(
							'w-full px-3 py-2 text-sm bg-card border border-border text-foreground',
							'placeholder:text-muted-foreground/50',
							'focus:outline-none focus:ring-1 focus:ring-blue-500/60 focus:border-blue-500/60',
							'transition-colors',
						)}
					/>
				</div>

				{/* OpNS Name */}
				<div className="flex flex-col gap-1.5">
					<div className="flex items-center gap-1.5">
						<label
							htmlFor="cfg-opns"
							className="text-sm font-medium text-foreground"
						>
							OpNS Name
						</label>
						<span className="text-xs text-muted-foreground">(optional)</span>
						<TooltipIcon label="OpNS (Ordinals Name System) gives your app a human-readable 1sat:// address on-chain." />
					</div>
					<div className="flex items-center border border-border bg-card focus-within:ring-1 focus-within:ring-blue-500/60 focus-within:border-blue-500/60 transition-colors">
						<span
							className="px-3 py-2 text-sm font-medium text-blue-400 select-none shrink-0 border-r border-border bg-muted/20"
							style={{ fontFamily: 'var(--font-mono)' }}
						>
							1sat://
						</span>
						<input
							id="cfg-opns"
							type="text"
							value={formData.opnsName}
							onChange={(e) => handleOpnsChange(e.target.value)}
							placeholder="yourname"
							className={cn(
								'flex-1 px-3 py-2 text-sm bg-transparent text-foreground',
								'placeholder:text-muted-foreground/50',
								'focus:outline-none',
							)}
							style={{ fontFamily: 'var(--font-mono)' }}
						/>
					</div>
					{opnsStatus === 'checking' && (
						<p className="text-xs text-muted-foreground flex items-center gap-1.5">
							<RefreshCw size={11} className="animate-spin" />
							Checking availability...
						</p>
					)}
					{opnsStatus === 'available' && (
						<p className="text-xs text-emerald-400 flex items-center gap-1.5">
							<Check size={11} strokeWidth={2.5} />
							{formData.opnsName} is available
						</p>
					)}
					{opnsStatus === 'taken' && (
						<p className="text-xs text-red-400 flex items-center gap-1.5">
							<X size={11} strokeWidth={2.5} />
							{formData.opnsName} is already taken
						</p>
					)}
				</div>

				{/* Signing Identity (OpNS) */}
				<div className="flex flex-col gap-1.5">
					<div className="flex items-center gap-1.5">
						<label
							htmlFor="cfg-identity"
							className="text-sm font-medium text-foreground"
						>
							Signing Identity (OpNS)
						</label>
						<TooltipIcon label="OpNS identity used to sign the inscription. Select one of your registered names." />
					</div>
					{identitiesLoading ? (
						<div className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground border border-border bg-card">
							<RefreshCw size={13} className="animate-spin" />
							Loading identities...
						</div>
					) : identities.length === 0 ? (
						<div className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground border border-border bg-card">
							No OpNS names found. Register a name first.
						</div>
					) : (
						<div className="relative">
							<select
								id="cfg-identity"
								value={formData.identity}
								onChange={(e) =>
									onChange({ ...formData, identity: e.target.value })
								}
								className={cn(
									'w-full appearance-none pl-3 pr-8 py-2 text-sm bg-card border border-border text-foreground',
									'focus:outline-none focus:ring-1 focus:ring-blue-500/60 focus:border-blue-500/60',
									'transition-colors cursor-pointer',
								)}
							>
								{identities.map((id) => (
									<option key={id.outpoint} value={id.name}>
										{id.name}
									</option>
								))}
							</select>
							<div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-muted-foreground">
								<ChevronRight size={14} className="rotate-90" />
							</div>
						</div>
					)}
				</div>

				{/* Requested Permissions */}
				<div className="flex flex-col gap-1.5">
					<div className="flex items-center gap-1.5">
						<span className="text-sm font-medium text-foreground">
							Requested Permissions
						</span>
						<TooltipIcon label="Permissions your app will request from the user's wallet when they first open it." />
					</div>
					<div className="flex flex-wrap items-center gap-2">
						{formData.permissions.map((perm) => (
							<span
								key={perm}
								className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-mono font-medium bg-blue-600/25 text-blue-300 ring-1 ring-blue-500/40"
							>
								{perm}
								<button
									type="button"
									onClick={() => handleRemovePermission(perm)}
									className="text-blue-300/60 hover:text-blue-200 transition-colors"
									aria-label={`Remove ${perm}`}
								>
									<X size={10} strokeWidth={2.5} />
								</button>
							</span>
						))}
						{addingPermission ? (
							<input
								ref={permissionInputRef}
								type="text"
								value={newPermissionName}
								onChange={(e) => setNewPermissionName(e.target.value)}
								onKeyDown={(e) => {
									if (e.key === 'Enter') handleConfirmPermission()
									if (e.key === 'Escape') handleCancelPermission()
								}}
								onBlur={handleConfirmPermission}
								placeholder="e.g. signTransaction"
								className="inline-flex items-center px-2.5 py-1 text-xs font-mono bg-card border border-blue-500/60 text-foreground placeholder:text-muted-foreground/50 focus:outline-none"
							/>
						) : (
							<button
								type="button"
								onClick={handleStartAddPermission}
								className="inline-flex items-center px-2.5 py-1 text-xs font-medium text-muted-foreground border border-dashed border-border hover:border-border/80 hover:text-foreground transition-colors"
							>
								+ Add
							</button>
						)}
					</div>
				</div>
			</div>

			{/* Footer */}
			<div className="flex items-center justify-between px-6 py-4 border-t border-border shrink-0">
				<Button variant="outline" size="sm" onClick={onBack} className="gap-2">
					<ArrowLeft size={14} />
					Back
				</Button>
				<Button
					size="sm"
					onClick={onNext}
					disabled={!isValid}
					className="gap-2 bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50 disabled:cursor-not-allowed"
				>
					Review &amp; Publish
					<ArrowRight size={14} />
				</Button>
			</div>
		</>
	)
}

// ─── Step 4: Publish ──────────────────────────────────────────────────────────

interface PublishStepProps {
	project: RecentProject
	formData: ConfigureFormData
	balanceBsv: number | null
	subState: PublishSubState
	onSubStateChange: (s: PublishSubState) => void
	onBack: () => void
}

function PublishStep({
	project,
	formData,
	balanceBsv,
	subState,
	onSubStateChange,
	onBack,
}: PublishStepProps) {
	const [copied, setCopied] = useState(false)
	const [txid, setTxid] = useState<string | null>(null)
	const [publishError, setPublishError] = useState<string | null>(null)

	const totalSizeKb = MOCK_BUILD_FILES.reduce((sum, f) => sum + f.sizeKb, 0)
	const totalSizeDisplay =
		totalSizeKb >= 1000
			? `${(totalSizeKb / 1000).toFixed(1)} MB`
			: `${totalSizeKb.toFixed(1)} KB`

	const opnsLabel = formData.opnsName || project.name.split('-')[0]

	// Back from the insufficient-funds substate returns to review rather than
	// leaving the publish step entirely — the user should see the cost summary
	// again before deciding to go further back.
	const handleInsufficientBack = useCallback(() => {
		onSubStateChange('review')
	}, [onSubStateChange])

	const handleCopyUrl = useCallback(() => {
		const url = `1sat://${opnsLabel}`
		navigator.clipboard.writeText(url).catch(() => {})
		setCopied(true)
		setTimeout(() => setCopied(false), 1500)
	}, [opnsLabel])

	const handlePublish = useCallback(async () => {
		const balance = balanceBsv ?? 0
		if (balance < COST_TOTAL) {
			onSubStateChange('insufficient')
			return
		}
		setPublishError(null)
		onSubStateChange('broadcasting')

		try {
			// TODO: Once real build files are available, inscribe actual file content.
			// For now we inscribe a placeholder to exercise the real RPC path.
			const res = await rpc.request.inscribeFile({
				base64Content: btoa(
					JSON.stringify({
						app: formData.appName || project.name,
						description: formData.description,
						identity: formData.identity,
					}),
				),
				contentType: 'application/json',
				map: {
					app: formData.appName || project.name,
					type: 'publish',
					...(formData.opnsName ? { opns: formData.opnsName } : {}),
				},
			})

			if (res.error) {
				setPublishError(res.error)
				onSubStateChange('review')
				return
			}
			if (res.txid) {
				setTxid(res.txid)
			}
			onSubStateChange('success')
		} catch (err) {
			setPublishError(err instanceof Error ? err.message : 'Publish failed')
			onSubStateChange('review')
		}
	}, [balanceBsv, onSubStateChange, formData, project.name])

	// ── Broadcasting ──────────────────────────────────────────────────────────
	if (subState === 'broadcasting') {
		return (
			<div className="flex flex-col items-center justify-center flex-1 gap-6 p-6">
				<div
					className="w-20 h-20 rounded-full flex items-center justify-center"
					style={{
						background:
							'linear-gradient(135deg, #6366f1 0%, #8b5cf6 50%, #a78bfa 100%)',
						boxShadow: '0 0 32px rgba(99,102,241,0.35)',
					}}
				>
					{/* Radio-wave icon */}
					<svg
						width="36"
						height="36"
						viewBox="0 0 24 24"
						fill="none"
						stroke="white"
						strokeWidth="1.75"
						strokeLinecap="round"
						strokeLinejoin="round"
						aria-hidden="true"
					>
						<path d="M5 12.55a11 11 0 0 1 14.08 0" />
						<path d="M1.42 9a16 16 0 0 1 21.16 0" />
						<path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
						<circle cx="12" cy="20" r="1" fill="white" stroke="none" />
					</svg>
				</div>

				<div className="flex flex-col items-center gap-2 text-center">
					<h2 className="text-xl font-bold text-foreground">
						Broadcasting to network...
					</h2>
					<p className="text-sm text-muted-foreground">
						Your inscription is being written to the blockchain.
					</p>
				</div>

				<div className="w-full max-w-sm border border-border bg-card/50">
					<div className="flex items-center justify-between px-4 py-3 border-b border-border">
						<span className="text-sm text-muted-foreground">Transaction</span>
						<span
							className="text-sm font-medium text-blue-400"
							style={{ fontFamily: 'var(--font-mono)' }}
						>
							Signing...
						</span>
					</div>
					<div className="flex items-center justify-between px-4 py-3 border-b border-border">
						<span className="text-sm text-muted-foreground">Files</span>
						<span
							className="text-sm font-medium text-emerald-400"
							style={{ fontFamily: 'var(--font-mono)' }}
						>
							{MOCK_BUILD_FILES.length} of {MOCK_BUILD_FILES.length} inscribed
						</span>
					</div>
					<div className="flex items-center justify-between px-4 py-3">
						<span className="text-sm text-muted-foreground">
							Estimated time
						</span>
						<span
							className="text-sm text-foreground"
							style={{ fontFamily: 'var(--font-mono)' }}
						>
							~30 seconds
						</span>
					</div>
				</div>
			</div>
		)
	}

	// ── Success ───────────────────────────────────────────────────────────────
	if (subState === 'success') {
		return (
			<div className="flex flex-col items-center justify-center flex-1 gap-6 p-6">
				<div
					className="w-20 h-20 rounded-full flex items-center justify-center"
					style={{
						background: 'rgba(16,185,129,0.15)',
						boxShadow: '0 0 0 1px rgba(16,185,129,0.3)',
					}}
				>
					<Check size={32} strokeWidth={2.5} className="text-emerald-400" />
				</div>

				<div className="flex flex-col items-center gap-2 text-center">
					<h2 className="text-2xl font-bold text-foreground">
						Published to Chain
					</h2>
					<p className="text-sm text-muted-foreground">
						Your app is now live and permanently on-chain.
					</p>
				</div>

				<div className="w-full max-w-sm border border-border bg-card/60 p-5 flex flex-col items-center gap-3">
					<p className="text-xs text-muted-foreground">Your app is live at</p>
					<div className="flex items-center gap-2">
						<span
							className="px-2 py-1 text-sm font-bold text-white bg-blue-600"
							style={{ fontFamily: 'var(--font-mono)' }}
						>
							1sat://
						</span>
						<span
							className="text-xl font-semibold text-foreground"
							style={{ fontFamily: 'var(--font-mono)' }}
						>
							{opnsLabel}
						</span>
						<button
							type="button"
							onClick={handleCopyUrl}
							aria-label="Copy URL"
							className="text-muted-foreground hover:text-foreground transition-colors"
						>
							{copied ? (
								<Check
									size={15}
									strokeWidth={2.5}
									className="text-emerald-400"
								/>
							) : (
								<Clipboard size={15} />
							)}
						</button>
					</div>
					<p
						className="text-xs text-muted-foreground"
						style={{ fontFamily: 'var(--font-mono)' }}
					>
						txid: {txid ?? 'pending...'}
					</p>
				</div>

				<div className="flex items-center gap-3">
					<Button
						size="sm"
						className="gap-2 bg-blue-600 hover:bg-blue-700 text-white"
					>
						<ExternalLink size={14} />
						Open in Browser
					</Button>
					<Button variant="outline" size="sm" className="gap-2">
						<Share2 size={14} />
						Share
					</Button>
				</div>
			</div>
		)
	}

	// ── Insufficient funds ────────────────────────────────────────────────────
	if (subState === 'insufficient') {
		const balance = balanceBsv ?? 0
		const shortfall = COST_TOTAL - balance
		return (
			<>
				<div className="flex flex-col gap-5 p-6 flex-1 overflow-y-auto">
					<div className="flex items-start gap-3 px-4 py-3 border border-amber-500/30 bg-amber-500/10">
						<AlertTriangle
							size={15}
							strokeWidth={2}
							className="shrink-0 mt-0.5 text-amber-400"
						/>
						<div className="flex flex-col gap-0.5">
							<span className="text-sm font-semibold text-amber-400">
								Insufficient funds
							</span>
							<span className="text-xs text-muted-foreground">
								You need {shortfall.toFixed(5)} BSV more to publish. Current
								balance: {balance.toFixed(5)} BSV
							</span>
						</div>
					</div>

					<div className="flex flex-col gap-2">
						<p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
							Cost Breakdown
						</p>
						<div className="border border-border bg-card/50">
							<div className="flex items-center justify-between px-4 py-3 border-b border-border">
								<span className="text-sm text-muted-foreground">
									Inscription ({MOCK_BUILD_FILES.length} files)
								</span>
								<span
									className="text-sm text-foreground tabular-nums"
									style={{ fontFamily: 'var(--font-mono)' }}
								>
									{COST_INSCRIPTION.toFixed(5)} BSV
								</span>
							</div>
							<div className="flex items-center justify-between px-4 py-3 border-b border-border">
								<span className="text-sm text-muted-foreground">
									MAP + AIP + Miner fee
								</span>
								<span
									className="text-sm text-foreground tabular-nums"
									style={{ fontFamily: 'var(--font-mono)' }}
								>
									{(COST_MAP + COST_AIP + COST_MINER).toFixed(5)} BSV
								</span>
							</div>
							<div className="flex items-center justify-between px-4 py-3 border-b border-border">
								<span className="text-sm font-semibold text-foreground">
									Total required
								</span>
								<span
									className="text-sm font-semibold text-foreground tabular-nums"
									style={{ fontFamily: 'var(--font-mono)' }}
								>
									{COST_TOTAL.toFixed(5)} BSV
								</span>
							</div>
							<div className="flex items-center justify-between px-4 py-3 border-b border-border">
								<span className="text-sm text-muted-foreground">
									Your balance
								</span>
								<span
									className="text-sm font-medium text-red-400 tabular-nums"
									style={{ fontFamily: 'var(--font-mono)' }}
								>
									{balance.toFixed(5)} BSV
								</span>
							</div>
							<div className="flex items-center justify-between px-4 py-3">
								<span className="text-sm font-semibold text-amber-400">
									Shortfall
								</span>
								<span
									className="text-sm font-semibold text-amber-400 tabular-nums"
									style={{ fontFamily: 'var(--font-mono)' }}
								>
									-{shortfall.toFixed(5)} BSV
								</span>
							</div>
						</div>
					</div>
				</div>

				<div className="flex items-center justify-between px-6 py-4 border-t border-border shrink-0">
					<Button
						variant="outline"
						size="sm"
						onClick={handleInsufficientBack}
						className="gap-2"
					>
						<ArrowLeft size={14} />
						Back
					</Button>
					<div className="flex items-center gap-2">
						<Button
							size="sm"
							className="gap-2 bg-blue-600 hover:bg-blue-700 text-white"
						>
							<Wallet size={14} />
							Deposit BSV
						</Button>
						<Button
							size="sm"
							disabled
							className="gap-2 opacity-40 cursor-not-allowed"
						>
							<Rocket size={14} />
							Publish
						</Button>
					</div>
				</div>
			</>
		)
	}

	// ── Review (default) ──────────────────────────────────────────────────────
	const appName = formData.appName || project.name
	const opnsDisplay = formData.opnsName
		? `1sat://${formData.opnsName}`
		: '\u2014'

	return (
		<>
			<div className="flex flex-col gap-5 p-6 flex-1 overflow-y-auto">
				{publishError && (
					<div className="flex items-start gap-3 px-4 py-3 border border-red-500/30 bg-red-500/10">
						<AlertCircle
							size={15}
							strokeWidth={2}
							className="shrink-0 mt-0.5 text-red-400"
						/>
						<div className="flex flex-col gap-0.5">
							<span className="text-sm font-semibold text-red-400">
								Publish failed
							</span>
							<span className="text-xs text-muted-foreground">
								{publishError}
							</span>
						</div>
					</div>
				)}

				{/* Summary card */}
				<div className="border border-border bg-card/50">
					<div className="flex items-center justify-between px-4 py-3 border-b border-border">
						<span className="text-sm text-muted-foreground">App Name</span>
						<span className="text-sm font-semibold text-foreground">
							{appName}
						</span>
					</div>
					<div className="flex items-center justify-between px-4 py-3 border-b border-border">
						<span className="text-sm text-muted-foreground">Identity</span>
						<span
							className="text-sm font-medium text-blue-400"
							style={{ fontFamily: 'var(--font-mono)' }}
						>
							{formData.identity}
						</span>
					</div>
					<div className="flex items-center justify-between px-4 py-3 border-b border-border">
						<span className="text-sm text-muted-foreground">OpNS</span>
						<span
							className={cn(
								'text-sm font-medium',
								formData.opnsName ? 'text-blue-400' : 'text-muted-foreground',
							)}
							style={{ fontFamily: 'var(--font-mono)' }}
						>
							{opnsDisplay}
						</span>
					</div>
					<div className="flex items-center justify-between px-4 py-3">
						<span className="text-sm text-muted-foreground">Files</span>
						<span
							className="text-sm text-foreground"
							style={{ fontFamily: 'var(--font-mono)' }}
						>
							{MOCK_BUILD_FILES.length} files ({totalSizeDisplay})
						</span>
					</div>
				</div>

				{/* Cost breakdown */}
				<div className="flex flex-col gap-2">
					<p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
						Cost Breakdown
					</p>
					<div className="border border-border bg-card/50">
						<div className="flex items-center justify-between px-4 py-3 border-b border-border">
							<span className="text-sm text-muted-foreground">
								Inscription ({MOCK_BUILD_FILES.length} files)
							</span>
							<span
								className="text-sm text-foreground tabular-nums"
								style={{ fontFamily: 'var(--font-mono)' }}
							>
								{COST_INSCRIPTION.toFixed(5)} BSV
							</span>
						</div>
						<div className="flex items-center justify-between px-4 py-3 border-b border-border">
							<span className="text-sm text-muted-foreground">
								MAP metadata
							</span>
							<span
								className="text-sm text-foreground tabular-nums"
								style={{ fontFamily: 'var(--font-mono)' }}
							>
								{COST_MAP.toFixed(5)} BSV
							</span>
						</div>
						<div className="flex items-center justify-between px-4 py-3 border-b border-border">
							<span className="text-sm text-muted-foreground">
								AIP signature
							</span>
							<span
								className="text-sm text-foreground tabular-nums"
								style={{ fontFamily: 'var(--font-mono)' }}
							>
								{COST_AIP.toFixed(5)} BSV
							</span>
						</div>
						<div className="flex items-center justify-between px-4 py-3 border-b border-border">
							<span className="text-sm text-muted-foreground">Miner fee</span>
							<span
								className="text-sm text-foreground tabular-nums"
								style={{ fontFamily: 'var(--font-mono)' }}
							>
								{COST_MINER.toFixed(5)} BSV
							</span>
						</div>
						{/* Total row */}
						<div className="flex items-center px-4 py-3 border-t border-border">
							<span className="text-sm font-bold text-foreground w-24">
								Total
							</span>
							<span
								className="flex-1 text-center text-sm font-bold text-foreground tabular-nums"
								style={{ fontFamily: 'var(--font-mono)' }}
							>
								{COST_TOTAL.toFixed(5)} BSV
							</span>
							<span
								className="text-xs text-muted-foreground tabular-nums"
								style={{ fontFamily: 'var(--font-mono)' }}
							>
								&asymp; $0.09
							</span>
						</div>
					</div>
				</div>
			</div>

			<div className="flex items-center justify-between px-6 py-4 border-t border-border shrink-0">
				<Button variant="outline" size="sm" onClick={onBack} className="gap-2">
					<ArrowLeft size={14} />
					Back
				</Button>
				<Button
					size="sm"
					onClick={handlePublish}
					className="gap-2 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold"
				>
					<Rocket size={14} />
					Publish to Chain
				</Button>
			</div>
		</>
	)
}

// ─── Wizard shell ─────────────────────────────────────────────────────────────

export interface PublishViewProps {
	params?: Record<string, string>
	onNavigate?: (url: string) => void
}

export function PublishView({ onNavigate }: PublishViewProps) {
	const [step, setStep] = useState<WizardStep>('select')
	const [selectedProject, setSelectedProject] = useState<RecentProject | null>(
		null,
	)
	const [publishSubState, setPublishSubState] =
		useState<PublishSubState>('review')

	// Real data from RPC
	const [identities, setIdentities] = useState<OpnsNameInfo[]>([])
	const [identitiesLoading, setIdentitiesLoading] = useState(true)
	const [balanceBsv, setBalanceBsv] = useState<number | null>(null)

	const [configForm, setConfigForm] = useState<ConfigureFormData>({
		appName: '',
		description: '',
		opnsName: '',
		identity: '',
		permissions: [...DEFAULT_PERMISSIONS],
	})

	// Fetch identities (OpNS names) and balance on mount
	const fetchedRef = useRef(false)
	useEffect(() => {
		if (fetchedRef.current) return
		fetchedRef.current = true

		let cancelled = false

		rpc.request
			.getOpnsNames()
			.then((r) => {
				if (cancelled) return
				setIdentities(r.names)
				if (r.names.length > 0) {
					setConfigForm((prev) => ({
						...prev,
						identity: prev.identity || r.names[0].name,
					}))
				}
				setIdentitiesLoading(false)
			})
			.catch(() => {
				if (!cancelled) {
					setIdentities([])
					setIdentitiesLoading(false)
				}
			})

		rpc.request
			.getBalance()
			.then((r) => {
				if (!cancelled) {
					setBalanceBsv((r.confirmed + r.unconfirmed) / SAT_PER_BSV)
				}
			})
			.catch(() => {
				if (!cancelled) setBalanceBsv(0)
			})

		return () => {
			cancelled = true
		}
	}, [])

	const handleClose = useCallback(() => {
		onNavigate?.('1sat://browser/new')
	}, [onNavigate])

	const handleSelectProject = useCallback((project: RecentProject) => {
		setSelectedProject(project)
		// Seed app name from project slug
		setConfigForm((prev) => ({
			...prev,
			appName: project.name
				.split('-')
				.map((w) => w.charAt(0).toUpperCase() + w.slice(1))
				.join(' '),
		}))
		try {
			const stored = localStorage.getItem(RECENT_PROJECTS_KEY)
			const existing: RecentProject[] = stored
				? (JSON.parse(stored) as RecentProject[])
				: []
			const filtered = existing.filter((p) => p.path !== project.path)
			const updated = [project, ...filtered].slice(0, 8)
			localStorage.setItem(RECENT_PROJECTS_KEY, JSON.stringify(updated))
		} catch {
			// Storage unavailable — proceed without persisting
		}
		setStep('build')
	}, [])

	const handleBackToBuild = useCallback(() => {
		setStep('select')
	}, [])

	const handleNextFromBuild = useCallback(() => {
		setStep('configure')
	}, [])

	const handleBackToConfigure = useCallback(() => {
		setStep('build')
	}, [])

	const handleNextFromConfigure = useCallback(() => {
		setPublishSubState('review')
		setStep('publish')
	}, [])

	const handleBackFromPublish = useCallback(() => {
		setPublishSubState('review')
		setStep('configure')
	}, [])

	// Track build failure by project type regardless of current step so the
	// step indicator preserves the error mark when navigating past the build step.
	const buildFailed = selectedProject?.type === 'CRA'

	const subtitle = (() => {
		if (step === 'select')
			return 'Deploy any project as an on-chain inscription'
		if (step === 'build' && selectedProject)
			return `${selectedProject.name} \u2014 Build & Preview`
		if (step === 'configure' && selectedProject)
			return `${selectedProject.name} \u2014 Configure Metadata`
		if (step === 'publish' && selectedProject) {
			if (publishSubState === 'broadcasting')
				return `${selectedProject.name} \u2014 Broadcasting...`
			if (publishSubState === 'success')
				return `${selectedProject.name} \u2014 Published!`
			return `${selectedProject.name} \u2014 Review & Confirm`
		}
		return ''
	})()

	const subtitleClass = (() => {
		if (step === 'build' && buildFailed) return 'text-red-400'
		if (step === 'publish' && publishSubState === 'broadcasting')
			return 'text-blue-400'
		if (step === 'publish' && publishSubState === 'success')
			return 'text-emerald-400'
		return 'text-muted-foreground'
	})()

	// Hide step indicator during broadcasting / success — full-screen state
	const hideStepIndicator =
		step === 'publish' &&
		(publishSubState === 'broadcasting' || publishSubState === 'success')

	return (
		<div className="flex items-center justify-center h-full bg-background p-6">
			<div
				className="flex flex-col w-full bg-card border border-border shadow-xl"
				style={{ maxWidth: 620, minHeight: 540, maxHeight: 680 }}
			>
				{/* Header */}
				<div className="flex items-start justify-between px-6 py-5 border-b border-border shrink-0">
					<div className="flex flex-col gap-0.5">
						<h1 className="text-lg font-semibold text-foreground leading-none">
							Publish to Chain
						</h1>
						<p className={cn('text-sm leading-none mt-1', subtitleClass)}>
							{subtitle}
						</p>
					</div>
					<button
						type="button"
						onClick={handleClose}
						className="text-muted-foreground hover:text-foreground transition-colors p-0.5"
						aria-label="Close"
					>
						<X size={16} strokeWidth={2} />
					</button>
				</div>

				{!hideStepIndicator && (
					<PublishStepIndicator
						current={step}
						buildFailed={buildFailed}
						publishSubState={publishSubState}
					/>
				)}

				{step === 'select' && <SelectStep onSelect={handleSelectProject} />}

				{step === 'build' && selectedProject && (
					<BuildStep
						project={selectedProject}
						onBack={handleBackToBuild}
						onNext={handleNextFromBuild}
					/>
				)}

				{step === 'configure' && selectedProject && (
					<ConfigureStep
						project={selectedProject}
						formData={configForm}
						identities={identities}
						identitiesLoading={identitiesLoading}
						onChange={setConfigForm}
						onBack={handleBackToConfigure}
						onNext={handleNextFromConfigure}
					/>
				)}

				{step === 'publish' && selectedProject && (
					<PublishStep
						project={selectedProject}
						formData={configForm}
						balanceBsv={balanceBsv}
						subState={publishSubState}
						onSubStateChange={setPublishSubState}
						onBack={handleBackFromPublish}
					/>
				)}
			</div>
		</div>
	)
}
