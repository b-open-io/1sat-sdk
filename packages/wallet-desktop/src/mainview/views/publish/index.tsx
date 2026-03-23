import {
	AlertCircle,
	ArrowLeft,
	ArrowRight,
	Check,
	ChevronRight,
	FileCode,
	FileCog,
	FileImage,
	FileJson,
	FileText,
	Folder,
	FolderUp,
	RefreshCw,
	X,
} from 'lucide-react'
import React, { useCallback, useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import { Button } from '../../components/ui/button'

// ─── Types ────────────────────────────────────────────────────────────────────

type WizardStep = 'select' | 'build' | 'configure' | 'publish'

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

// ─── Mock data ────────────────────────────────────────────────────────────────

const RECENT_PROJECTS_KEY = '1sat-publish-recent'

const DEFAULT_RECENT: RecentProject[] = [
	{ name: 'bitbattle-arena', path: '~/code/bitbattle-arena', type: 'Vite' },
	{ name: 'ordinal-gallery', path: '~/code/ordinal-gallery', type: 'CRA' },
	{ name: 'research-agent', path: '~/code/research-agent', type: 'Bot' },
	{ name: 'bsv-pricing-skill', path: '~/code/bsv-pricing-skill', type: 'Skill' },
]

const MOCK_BUILD_FILES: BuildFile[] = [
	{ name: 'index.html', mime: 'text/html', sizeKb: 2.1 },
	{ name: 'index-Da4x.js', mime: 'text/javascript', sizeKb: 98.4 },
	{ name: 'index-Bk2m.css', mime: 'text/css', sizeKb: 38.7 },
	{ name: 'favicon.svg', mime: 'image/svg+xml', sizeKb: 2.8 },
]

const MOCK_BUILD_ERROR_LOG = `$ bun run build
vite v6.0.3 building for production...
transforming (1247 modules)...

ERROR  src/App.tsx:42:18
  Property 'wallet' does not exist on type
  'IntrinsicAttributes & Props'

ERROR  src/components/Game.tsx:89:5
  Cannot find module './assets/sprite.png'`

// ─── Step indicator ───────────────────────────────────────────────────────────

const STEPS: { id: WizardStep; label: string; number: number }[] = [
	{ id: 'select', label: 'Select', number: 1 },
	{ id: 'build', label: 'Build', number: 2 },
	{ id: 'configure', label: 'Configure', number: 3 },
	{ id: 'publish', label: 'Publish', number: 4 },
]

type StepStatus = 'complete' | 'active' | 'error' | 'pending'

interface PublishStepIndicatorProps {
	current: WizardStep
	buildFailed?: boolean
}

function PublishStepIndicator({ current, buildFailed }: PublishStepIndicatorProps) {
	const currentIndex = STEPS.findIndex((s) => s.id === current)

	return (
		<div className="flex items-center gap-0 px-6 py-4 border-b border-border">
			{STEPS.map((step, idx) => {
				let status: StepStatus
				if (idx < currentIndex) {
					status = step.id === 'build' && buildFailed ? 'error' : 'complete'
				} else if (idx === currentIndex) {
					status = step.id === 'build' && buildFailed ? 'error' : 'active'
				} else {
					status = 'pending'
				}

				return (
					<React.Fragment key={step.id}>
						<div className="flex items-center gap-2">
							{/* Circle */}
							<div
								className={cn(
									'w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold shrink-0 transition-colors',
									status === 'complete' &&
										'bg-emerald-500/20 text-emerald-400 ring-1 ring-emerald-500/40',
									status === 'active' &&
										'bg-blue-500 text-white shadow-sm shadow-blue-500/30',
									status === 'error' &&
										'bg-red-500/20 text-red-400 ring-1 ring-red-500/40',
									status === 'pending' && 'bg-muted text-muted-foreground',
								)}
							>
								{status === 'complete' ? (
									<Check size={14} strokeWidth={2.5} aria-label="Complete" />
								) : status === 'error' ? (
									<X size={14} strokeWidth={2.5} aria-label="Error" />
								) : (
									<span>{step.number}</span>
								)}
							</div>
							{/* Label */}
							<span
								className={cn(
									'text-sm font-medium',
									status === 'active' && 'text-foreground font-semibold',
									(status === 'pending' || status === 'complete') &&
										'text-muted-foreground',
									status === 'error' && 'text-red-400',
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
	if (mime.includes('html')) return <FileCode size={15} className="text-blue-400" />
	if (mime.includes('javascript')) return <FileJson size={15} className="text-yellow-400" />
	if (mime.includes('css')) return <FileCog size={15} className="text-purple-400" />
	if (mime.includes('svg') || mime.includes('image')) return <FileImage size={15} className="text-emerald-400" />
	if (name.endsWith('.json')) return <FileJson size={15} className="text-orange-400" />
	return <FileText size={15} className="text-muted-foreground" />
}

// ─── Step 1: Select ───────────────────────────────────────────────────────────

interface SelectStepProps {
	onSelect: (project: RecentProject) => void
}

function SelectStep({ onSelect }: SelectStepProps) {
	const [recentProjects, setRecentProjects] = useState<RecentProject[]>([])
	const [isDragging, setIsDragging] = useState(false)

	// Load from localStorage on mount
	useEffect(() => {
		try {
			const stored = localStorage.getItem(RECENT_PROJECTS_KEY)
			if (stored) {
				const parsed = JSON.parse(stored) as RecentProject[]
				setRecentProjects(parsed)
			} else {
				// Seed with defaults for dev
				setRecentProjects(DEFAULT_RECENT)
			}
		} catch {
			setRecentProjects(DEFAULT_RECENT)
		}
	}, [])

	const handleDropzoneClick = useCallback(() => {
		// In production, this would call the pickFile RPC.
		// For now, simulate selecting the first recent project.
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
			// In production, read e.dataTransfer.files[0] path and detect type.
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
			<div
				role="button"
				tabIndex={0}
				aria-label="Select a project folder"
				onClick={handleDropzoneClick}
				onKeyDown={(e) => {
					if (e.key === 'Enter' || e.key === ' ') handleDropzoneClick()
				}}
				onDragOver={handleDragOver}
				onDragLeave={handleDragLeave}
				onDrop={handleDrop}
				className={cn(
					'flex flex-col items-center justify-center gap-3 py-10 px-6',
					'border border-dashed cursor-pointer transition-colors select-none',
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
				{/* Supported types badge */}
				<div className="flex items-center gap-1.5 px-3 py-1.5 bg-muted/60 border border-border text-xs text-muted-foreground font-mono">
					React&nbsp;&middot;&nbsp;Skill&nbsp;&middot;&nbsp;Bot&nbsp;&middot;&nbsp;Static
					Site&nbsp;&middot;&nbsp;Media
				</div>
			</div>

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
									className={cn('shrink-0 transition-colors', FOLDER_COLORS[project.type])}
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
	// Toggle between success/error by simulating — in practice driven by real build output.
	// For demo purposes, use a deterministic approach based on project type.
	const buildStatus: BuildStatus = project.type === 'CRA' ? 'error' : 'success'

	const totalSizeKb = MOCK_BUILD_FILES.reduce((sum, f) => sum + f.sizeKb, 0)
	const totalSizeDisplay =
		totalSizeKb >= 1000
			? `${(totalSizeKb / 1000).toFixed(1)} MB`
			: `${totalSizeKb.toFixed(1)} KB`

	return (
		<>
			{/* Scrollable body */}
			<div className="flex flex-col gap-5 p-6 flex-1 overflow-y-auto">
				{/* Status banner */}
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
						<span className="text-sm font-medium">Build failed with 2 errors</span>
					</div>
				)}

				{/* File table or error log */}
				{buildStatus === 'success' ? (
					<div className="flex flex-col gap-2">
						<p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
							Build Output
						</p>
						<div className="border border-border">
							{/* Table header */}
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
							{/* Rows */}
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
							style={{ fontFamily: 'var(--font-mono)', fontSize: 12, lineHeight: 1.7 }}
						>
							{MOCK_BUILD_ERROR_LOG.split('\n').map((line, i) => {
								const isError = line.startsWith('ERROR') || line.startsWith('  Property') || line.startsWith('  Cannot')
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

			{/* Footer */}
			<div className="flex items-center justify-between px-6 py-4 border-t border-border shrink-0">
				<Button variant="outline" size="sm" onClick={onBack} className="gap-2">
					<ArrowLeft size={14} />
					Back
				</Button>
				{buildStatus === 'success' ? (
					<Button size="sm" onClick={onNext} className="gap-2 bg-blue-600 hover:bg-blue-700 text-white">
						Configure
						<ArrowRight size={14} />
					</Button>
				) : (
					<Button size="sm" onClick={() => {}} className="gap-2 bg-blue-600 hover:bg-blue-700 text-white">
						<RefreshCw size={14} />
						Retry Build
					</Button>
				)}
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
	const [selectedProject, setSelectedProject] = useState<RecentProject | null>(null)

	const handleClose = useCallback(() => {
		onNavigate?.('1sat://browser/new')
	}, [onNavigate])

	const handleSelectProject = useCallback((project: RecentProject) => {
		setSelectedProject(project)
		// Persist to recent projects
		try {
			const stored = localStorage.getItem(RECENT_PROJECTS_KEY)
			const existing: RecentProject[] = stored ? JSON.parse(stored) : []
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

	// Subtitle for the header
	const subtitle = (() => {
		if (step === 'select') return 'Deploy any project as an on-chain inscription'
		if (step === 'build' && selectedProject) {
			return `${selectedProject.name} \u2014 Build & Preview`
		}
		if (step === 'configure' && selectedProject) {
			return `${selectedProject.name} \u2014 Configure`
		}
		if (step === 'publish' && selectedProject) {
			return `${selectedProject.name} \u2014 Publish`
		}
		return ''
	})()

	// Determine build failed state for step indicator
	const buildFailed =
		step === 'build' &&
		selectedProject?.type === 'CRA'

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
						<p
							className={cn(
								'text-sm leading-none mt-1',
								step === 'build' && buildFailed
									? 'text-red-400'
									: 'text-muted-foreground',
							)}
						>
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

				{/* Step indicator */}
				<PublishStepIndicator current={step} buildFailed={buildFailed} />

				{/* Step content */}
				{step === 'select' && (
					<SelectStep onSelect={handleSelectProject} />
				)}
				{step === 'build' && selectedProject && (
					<BuildStep
						project={selectedProject}
						onBack={handleBackToBuild}
						onNext={handleNextFromBuild}
					/>
				)}
				{step === 'configure' && (
					<div className="flex flex-col items-center justify-center flex-1 gap-2">
						<p className="text-sm font-semibold text-foreground">Configure</p>
						<p className="text-xs text-muted-foreground">Coming in Step 3</p>
					</div>
				)}
				{step === 'publish' && (
					<div className="flex flex-col items-center justify-center flex-1 gap-2">
						<p className="text-sm font-semibold text-foreground">Publish</p>
						<p className="text-xs text-muted-foreground">Coming in Step 4</p>
					</div>
				)}
			</div>
		</div>
	)
}
