import { useCallback, useEffect, useRef, useState } from 'react'
import {
	CheckCircle,
	Code,
	Copy,
	FileText,
	Image as ImageIcon,
	Loader2,
	UploadCloud,
	Video,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '../../components/ui/button'
import { rpc } from '../../rpc'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type PublishStep = 1 | 2 | 3 | 4 | 5 | 6

type PublishType = 'image' | 'video' | 'document' | 'html'

interface MetadataField {
	id: string
	key: string
	value: string
}

interface FileData {
	base64Content: string
	contentType: string
	filename: string
	sizeBytes: number
	previewUrl?: string
}

interface PublishResult {
	txid: string
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STEP_LABELS: Record<PublishStep, string> = {
	1: 'Type',
	2: 'Upload',
	3: 'Metadata',
	4: 'Review',
	5: 'Broadcast',
	6: 'Done',
}

const MIME_FILTERS: Record<PublishType, string> = {
	image: 'image/*',
	video: 'video/*',
	document: 'application/pdf,text/plain,text/html,application/json',
	html: 'text/html',
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
	return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

function generateId(): string {
	return `field-${Math.random().toString(36).slice(2, 9)}`
}

function truncateTxid(txid: string): string {
	if (txid.length <= 16) return txid
	return `${txid.slice(0, 8)}...${txid.slice(-8)}`
}

// ---------------------------------------------------------------------------
// Progress bar
// ---------------------------------------------------------------------------

function WizardProgress({ step }: { step: PublishStep }) {
	const steps: PublishStep[] = [1, 2, 3, 4, 5, 6]

	return (
		<div className="px-6 pt-5 pb-4 flex flex-col gap-2 shrink-0">
			{/* Segments */}
			<div className="flex gap-1">
				{steps.map((s) => (
					<div
						key={s}
						className={cn(
							'h-1 flex-1 rounded-full transition-colors',
							s < step && 'bg-primary',
							s === step && 'bg-primary/40',
							s > step && 'bg-border',
						)}
					/>
				))}
			</div>
			{/* Labels */}
			<div className="flex">
				{steps.map((s) => (
					<div key={s} className="flex-1 flex justify-center">
						<span
							className={cn(
								'text-[10px] font-medium transition-colors select-none',
								s <= step ? 'text-foreground' : 'text-muted-foreground',
							)}
						>
							{STEP_LABELS[s]}
						</span>
					</div>
				))}
			</div>
		</div>
	)
}

// ---------------------------------------------------------------------------
// Step 1: Select Type
// ---------------------------------------------------------------------------

const TYPE_OPTIONS: { type: PublishType; label: string; icon: React.ReactNode }[] = [
	{
		type: 'image',
		label: 'Image',
		icon: <ImageIcon size={28} strokeWidth={1.5} />,
	},
	{
		type: 'video',
		label: 'Video',
		icon: <Video size={28} strokeWidth={1.5} />,
	},
	{
		type: 'document',
		label: 'Document',
		icon: <FileText size={28} strokeWidth={1.5} />,
	},
	{
		type: 'html',
		label: 'HTML App',
		icon: <Code size={28} strokeWidth={1.5} />,
	},
]

function SelectTypeStep({
	selected,
	onSelect,
}: {
	selected: PublishType | null
	onSelect: (t: PublishType) => void
}) {
	return (
		<div className="flex flex-col gap-4 px-6 pb-4 flex-1">
			<p className="text-base font-semibold text-foreground">Choose what to publish</p>
			<div className="grid grid-cols-2 gap-3">
				{TYPE_OPTIONS.map(({ type, label, icon }) => (
					<button
						key={type}
						type="button"
						onClick={() => onSelect(type)}
						className={cn(
							'flex flex-col items-center justify-center gap-3 p-6 rounded-lg',
							'bg-card border text-center transition-colors',
							'hover:border-primary',
							selected === type
								? 'border-primary border-2 text-primary'
								: 'border-border text-muted-foreground',
						)}
					>
						{icon}
						<span className="text-sm font-medium text-foreground">{label}</span>
					</button>
				))}
			</div>
		</div>
	)
}

// ---------------------------------------------------------------------------
// Step 2: Upload
// ---------------------------------------------------------------------------

function UploadStep({
	publishType,
	fileData,
	onFileLoaded,
}: {
	publishType: PublishType
	fileData: FileData | null
	onFileLoaded: (data: FileData) => void
}) {
	const [isDragging, setIsDragging] = useState(false)
	const [isLoading, setIsLoading] = useState(false)
	const [error, setError] = useState<string | null>(null)

	const handlePickFile = useCallback(async () => {
		setIsLoading(true)
		setError(null)
		try {
			const result = await rpc.request.pickFile({
				allowedFileTypes: MIME_FILTERS[publishType],
			})
			if ('error' in result) {
				setError(result.error)
				return
			}
			const previewUrl =
				result.contentType.startsWith('image/')
					? `data:${result.contentType};base64,${result.base64Content}`
					: undefined
			onFileLoaded({
				base64Content: result.base64Content,
				contentType: result.contentType,
				filename: result.filename,
				sizeBytes: result.sizeBytes,
				previewUrl,
			})
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Failed to pick file')
		} finally {
			setIsLoading(false)
		}
	}, [publishType, onFileLoaded])

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
			// Native file drop not supported in this Electrobun environment —
			// fall through to the native file picker for consistency.
			handlePickFile()
		},
		[handlePickFile],
	)

	if (fileData) {
		return (
			<div className="flex flex-col gap-4 px-6 pb-4 flex-1">
				<p className="text-base font-semibold text-foreground">File selected</p>
				{fileData.previewUrl ? (
					<div className="rounded-lg overflow-hidden border border-border bg-card flex items-center justify-center" style={{ maxHeight: 220 }}>
						<img
							src={fileData.previewUrl}
							alt={fileData.filename}
							className="max-h-[220px] max-w-full object-contain"
						/>
					</div>
				) : (
					<div className="flex items-center gap-4 p-4 rounded-lg border border-border bg-card">
						<FileText size={32} strokeWidth={1.5} className="text-muted-foreground shrink-0" />
						<div className="flex flex-col gap-1 min-w-0">
							<span className="text-sm font-medium text-foreground truncate">
								{fileData.filename}
							</span>
							<span className="text-xs text-muted-foreground font-mono">
								{fileData.contentType} &middot; {formatBytes(fileData.sizeBytes)}
							</span>
						</div>
					</div>
				)}
				<button
					type="button"
					onClick={handlePickFile}
					className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2 self-start transition-colors"
				>
					Choose a different file
				</button>
				{error && <p className="text-xs text-destructive">{error}</p>}
			</div>
		)
	}

	return (
		<div className="flex flex-col gap-4 px-6 pb-4 flex-1">
			<p className="text-base font-semibold text-foreground">Upload your file</p>
			<div
				role="button"
				tabIndex={0}
				aria-label="Drop file here or click to browse"
				onClick={handlePickFile}
				onKeyDown={(e) => {
					if (e.key === 'Enter' || e.key === ' ') handlePickFile()
				}}
				onDragOver={handleDragOver}
				onDragLeave={handleDragLeave}
				onDrop={handleDrop}
				className={cn(
					'flex flex-col items-center justify-center gap-3 rounded-lg p-12',
					'border-2 border-dashed cursor-pointer select-none transition-colors',
					isDragging
						? 'border-primary bg-primary/5'
						: 'border-border hover:border-primary/50 bg-card',
				)}
			>
				{isLoading ? (
					<Loader2 size={40} strokeWidth={1.5} className="animate-spin text-muted-foreground" />
				) : (
					<UploadCloud
						size={40}
						strokeWidth={1.5}
						className={cn(
							'transition-colors',
							isDragging ? 'text-primary' : 'text-muted-foreground',
						)}
					/>
				)}
				<div className="flex flex-col items-center gap-1">
					<p className="text-sm font-medium text-foreground">Drop file here or click to browse</p>
					<p className="text-xs text-muted-foreground">{MIME_FILTERS[publishType]}</p>
				</div>
			</div>
			{error && <p className="text-xs text-destructive">{error}</p>}
		</div>
	)
}

// ---------------------------------------------------------------------------
// Step 3: Metadata
// ---------------------------------------------------------------------------

function MetadataStep({
	name,
	description,
	fields,
	onNameChange,
	onDescriptionChange,
	onFieldsChange,
}: {
	name: string
	description: string
	fields: MetadataField[]
	onNameChange: (v: string) => void
	onDescriptionChange: (v: string) => void
	onFieldsChange: (fields: MetadataField[]) => void
}) {
	const handleAddField = useCallback(() => {
		onFieldsChange([...fields, { id: generateId(), key: '', value: '' }])
	}, [fields, onFieldsChange])

	const handleFieldKeyChange = useCallback(
		(id: string, key: string) => {
			onFieldsChange(fields.map((f) => (f.id === id ? { ...f, key } : f)))
		},
		[fields, onFieldsChange],
	)

	const handleFieldValueChange = useCallback(
		(id: string, value: string) => {
			onFieldsChange(fields.map((f) => (f.id === id ? { ...f, value } : f)))
		},
		[fields, onFieldsChange],
	)

	const handleRemoveField = useCallback(
		(id: string) => {
			onFieldsChange(fields.filter((f) => f.id !== id))
		},
		[fields, onFieldsChange],
	)

	return (
		<div className="flex flex-col gap-4 px-6 pb-4 flex-1 overflow-y-auto">
			<p className="text-base font-semibold text-foreground">Add metadata</p>

			{/* Name */}
			<div className="flex flex-col gap-1.5">
				<label
					htmlFor="publish-name"
					className="text-xs font-medium text-muted-foreground uppercase tracking-wider"
				>
					Name <span className="normal-case tracking-normal">(optional)</span>
				</label>
				<input
					id="publish-name"
					type="text"
					value={name}
					onChange={(e) => onNameChange(e.target.value)}
					placeholder="e.g. My Artwork"
					className={cn(
						'w-full px-3 py-2 rounded-md text-sm',
						'bg-card border border-border text-foreground',
						'placeholder:text-muted-foreground',
						'focus:outline-none focus:ring-1 focus:ring-primary',
					)}
				/>
			</div>

			{/* Description */}
			<div className="flex flex-col gap-1.5">
				<label
					htmlFor="publish-description"
					className="text-xs font-medium text-muted-foreground uppercase tracking-wider"
				>
					Description <span className="normal-case tracking-normal">(optional)</span>
				</label>
				<textarea
					id="publish-description"
					value={description}
					onChange={(e) => onDescriptionChange(e.target.value)}
					placeholder="Describe your inscription..."
					rows={3}
					className={cn(
						'w-full px-3 py-2 rounded-md text-sm resize-none',
						'bg-card border border-border text-foreground',
						'placeholder:text-muted-foreground',
						'focus:outline-none focus:ring-1 focus:ring-primary',
					)}
				/>
			</div>

			{/* Dynamic fields */}
			{fields.length > 0 && (
				<div className="flex flex-col gap-2">
					<p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
						Custom Fields
					</p>
					{fields.map((field) => (
						<div key={field.id} className="flex gap-2 items-center">
							<input
								type="text"
								value={field.key}
								onChange={(e) => handleFieldKeyChange(field.id, e.target.value)}
								placeholder="Key"
								className={cn(
									'flex-1 px-3 py-2 rounded-md text-sm',
									'bg-card border border-border text-foreground',
									'placeholder:text-muted-foreground',
									'focus:outline-none focus:ring-1 focus:ring-primary',
								)}
							/>
							<input
								type="text"
								value={field.value}
								onChange={(e) => handleFieldValueChange(field.id, e.target.value)}
								placeholder="Value"
								className={cn(
									'flex-1 px-3 py-2 rounded-md text-sm',
									'bg-card border border-border text-foreground',
									'placeholder:text-muted-foreground',
									'focus:outline-none focus:ring-1 focus:ring-primary',
								)}
							/>
							<button
								type="button"
								onClick={() => handleRemoveField(field.id)}
								aria-label="Remove field"
								className="text-muted-foreground hover:text-destructive transition-colors p-1 shrink-0"
							>
								<svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
									<path d="M1 1L13 13M13 1L1 13" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
								</svg>
							</button>
						</div>
					))}
				</div>
			)}

			<button
				type="button"
				onClick={handleAddField}
				className={cn(
					'self-start text-xs font-medium px-3 py-1.5 rounded-md',
					'border border-dashed border-border',
					'text-muted-foreground hover:text-foreground hover:border-primary/50',
					'transition-colors',
				)}
			>
				+ Add Field
			</button>
		</div>
	)
}

// ---------------------------------------------------------------------------
// Step 4: Review
// ---------------------------------------------------------------------------

function ReviewStep({
	publishType,
	fileData,
	name,
	description,
	fields,
}: {
	publishType: PublishType
	fileData: FileData
	name: string
	description: string
	fields: MetadataField[]
}) {
	const mapEntries: Array<[string, string]> = [
		...(name ? [['name', name] as [string, string]] : []),
		...(description ? [['description', description] as [string, string]] : []),
		...fields.filter((f) => f.key.trim()).map((f) => [f.key.trim(), f.value] as [string, string]),
	]

	const typeLabel =
		publishType === 'image'
			? 'Image'
			: publishType === 'video'
				? 'Video'
				: publishType === 'document'
					? 'Document'
					: 'HTML App'

	return (
		<div className="flex flex-col gap-4 px-6 pb-4 flex-1 overflow-y-auto">
			<p className="text-base font-semibold text-foreground">Review before broadcasting</p>

			{/* File preview card */}
			<div className="rounded-lg border border-border bg-card overflow-hidden">
				{fileData.previewUrl ? (
					<div className="flex items-center justify-center bg-muted/30 p-3" style={{ maxHeight: 140 }}>
						<img
							src={fileData.previewUrl}
							alt={fileData.filename}
							className="max-h-[140px] max-w-full object-contain"
						/>
					</div>
				) : null}
				<div className="flex flex-col gap-2 p-4">
					<div className="flex items-center justify-between">
						<span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
							Type
						</span>
						<span className="text-sm text-foreground">{typeLabel}</span>
					</div>
					<div className="flex items-center justify-between">
						<span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
							File
						</span>
						<span className="text-sm text-foreground font-mono truncate max-w-[60%]">
							{fileData.filename}
						</span>
					</div>
					<div className="flex items-center justify-between">
						<span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
							Size
						</span>
						<span className="text-sm text-foreground font-mono">
							{formatBytes(fileData.sizeBytes)}
						</span>
					</div>
					<div className="flex items-center justify-between">
						<span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
							Content-Type
						</span>
						<span className="text-sm text-foreground font-mono">{fileData.contentType}</span>
					</div>
				</div>
			</div>

			{/* Metadata table */}
			{mapEntries.length > 0 && (
				<div className="flex flex-col gap-2">
					<p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
						MAP Metadata
					</p>
					<div className="rounded-lg border border-border bg-card divide-y divide-border">
						{mapEntries.map(([key, value]) => (
							<div key={key} className="flex items-center gap-4 px-4 py-2.5">
								<span className="text-xs font-mono text-muted-foreground w-24 shrink-0">{key}</span>
								<span className="text-xs text-foreground truncate">{value}</span>
							</div>
						))}
					</div>
				</div>
			)}

			{/* Estimated cost */}
			<div className="flex items-center justify-between px-4 py-3 rounded-lg border border-border bg-muted/20">
				<span className="text-sm text-muted-foreground">Estimated cost</span>
				<span className="text-sm font-mono text-foreground">~1 sat + fee</span>
			</div>
		</div>
	)
}

// ---------------------------------------------------------------------------
// Step 5: Broadcasting
// ---------------------------------------------------------------------------

function BroadcastStep({
	publishType,
	fileData,
	name,
	description,
	fields,
	onSuccess,
	onError,
}: {
	publishType: PublishType
	fileData: FileData
	name: string
	description: string
	fields: MetadataField[]
	onSuccess: (result: PublishResult) => void
	onError: (err: string) => void
}) {
	const calledRef = useRef(false)

	useEffect(() => {
		if (calledRef.current) return
		calledRef.current = true

		const map: Record<string, string> = {}
		if (name.trim()) map.name = name.trim()
		if (description.trim()) map.description = description.trim()
		for (const field of fields) {
			if (field.key.trim()) map[field.key.trim()] = field.value
		}

		rpc.request
			.inscribeFile({
				base64Content: fileData.base64Content,
				contentType: fileData.contentType,
				map: Object.keys(map).length > 0 ? map : undefined,
			})
			.then((result) => {
				if ('error' in result && result.error) {
					onError(result.error)
				} else if (result.txid) {
					onSuccess({ txid: result.txid })
				} else {
					onError('Broadcast succeeded but no txid was returned')
				}
			})
			.catch((err: unknown) => {
				onError(err instanceof Error ? err.message : 'Broadcast failed')
			})
	}, [publishType, fileData, name, description, fields, onSuccess, onError])

	return (
		<div className="flex flex-col items-center justify-center flex-1 gap-3 px-6 pb-4">
			<Loader2 size={48} strokeWidth={1.5} className="animate-spin text-muted-foreground" />
			<p className="text-sm text-muted-foreground">Broadcasting to network...</p>
		</div>
	)
}

// ---------------------------------------------------------------------------
// Step 6: Success
// ---------------------------------------------------------------------------

function SuccessStep({
	result,
	onNavigate,
	onReset,
}: {
	result: PublishResult
	onNavigate?: (url: string) => void
	onReset: () => void
}) {
	const [copied, setCopied] = useState(false)

	const handleCopy = useCallback(() => {
		navigator.clipboard.writeText(result.txid).then(() => {
			setCopied(true)
			setTimeout(() => setCopied(false), 1500)
		})
	}, [result.txid])

	return (
		<div className="flex flex-col items-center justify-center flex-1 gap-5 px-6 pb-4">
			<CheckCircle size={48} strokeWidth={1.5} className="text-emerald-500" />
			<div className="flex flex-col items-center gap-1">
				<p className="text-lg font-semibold text-foreground">Published!</p>
				<p className="text-xs text-muted-foreground">Your inscription is on-chain</p>
			</div>

			{/* Txid */}
			<div className="flex items-center gap-2 px-3 py-2 rounded-md border border-border bg-card">
				<span className="text-xs font-mono text-muted-foreground">
					{truncateTxid(result.txid)}
				</span>
				<button
					type="button"
					onClick={handleCopy}
					aria-label="Copy transaction ID"
					className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
				>
					{copied ? (
						<CheckCircle size={13} className="text-emerald-500" />
					) : (
						<Copy size={13} />
					)}
				</button>
			</div>

			{/* Actions */}
			<div className="flex flex-col gap-2 w-full max-w-[240px]">
				<Button
					className="w-full"
					onClick={() => onNavigate?.('1sat://ordinals/gallery')}
				>
					View Inscription
				</Button>
				<Button variant="outline" className="w-full" onClick={onReset}>
					Publish Another
				</Button>
			</div>
		</div>
	)
}

// ---------------------------------------------------------------------------
// Footer
// ---------------------------------------------------------------------------

function WizardFooter({
	step,
	canNext,
	onBack,
	onNext,
}: {
	step: PublishStep
	canNext: boolean
	onBack: () => void
	onNext: () => void
}) {
	// Footer is not shown on Broadcast or Done steps
	if (step === 5 || step === 6) return null

	return (
		<div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-border shrink-0">
			{step > 1 && (
				<Button variant="outline" size="sm" onClick={onBack}>
					Back
				</Button>
			)}
			<Button size="sm" onClick={onNext} disabled={!canNext}>
				{step === 4 ? 'Broadcast' : 'Next'}
			</Button>
		</div>
	)
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export interface PublishViewProps {
	params?: Record<string, string>
	onNavigate?: (url: string) => void
}

export function PublishView({ onNavigate }: PublishViewProps) {
	const [step, setStep] = useState<PublishStep>(1)
	const [selectedType, setSelectedType] = useState<PublishType | null>(null)
	const [fileData, setFileData] = useState<FileData | null>(null)
	const [name, setName] = useState('')
	const [description, setDescription] = useState('')
	const [metadataFields, setMetadataFields] = useState<MetadataField[]>([])
	const [result, setResult] = useState<PublishResult | null>(null)
	const [broadcastError, setBroadcastError] = useState<string | null>(null)

	const canNext: boolean = (() => {
		if (step === 1) return selectedType !== null
		if (step === 2) return fileData !== null
		// Metadata and Review steps always allow proceeding
		return true
	})()

	const handleNext = useCallback(() => {
		if (step < 6) setStep((s) => (s + 1) as PublishStep)
	}, [step])

	const handleBack = useCallback(() => {
		if (step > 1) setStep((s) => (s - 1) as PublishStep)
	}, [step])

	const handleBroadcastSuccess = useCallback((res: PublishResult) => {
		setResult(res)
		setStep(6)
	}, [])

	const handleBroadcastError = useCallback((err: string) => {
		setBroadcastError(err)
		// Step back to review with error visible
		setStep(4)
	}, [])

	const handleReset = useCallback(() => {
		setStep(1)
		setSelectedType(null)
		setFileData(null)
		setName('')
		setDescription('')
		setMetadataFields([])
		setResult(null)
		setBroadcastError(null)
	}, [])

	return (
		<div className="flex items-center justify-center h-full bg-background p-6">
			<div
				className="flex flex-col w-full bg-card border border-border shadow-xl overflow-hidden"
				style={{ maxWidth: 560, minHeight: 520, maxHeight: 700 }}
			>
				{/* Progress bar */}
				<WizardProgress step={step} />

				{/* Divider */}
				<div className="h-px bg-border shrink-0" />

				{/* Step content */}
				<div className="flex flex-col flex-1 overflow-hidden pt-4">
					{step === 1 && (
						<SelectTypeStep selected={selectedType} onSelect={setSelectedType} />
					)}

					{step === 2 && selectedType && (
						<UploadStep
							publishType={selectedType}
							fileData={fileData}
							onFileLoaded={setFileData}
						/>
					)}

					{step === 3 && (
						<MetadataStep
							name={name}
							description={description}
							fields={metadataFields}
							onNameChange={setName}
							onDescriptionChange={setDescription}
							onFieldsChange={setMetadataFields}
						/>
					)}

					{step === 4 && selectedType && fileData && (
						<>
							<ReviewStep
								publishType={selectedType}
								fileData={fileData}
								name={name}
								description={description}
								fields={metadataFields}
							/>
							{broadcastError && (
								<div className="mx-6 mb-4 px-4 py-3 rounded-md border border-destructive/30 bg-destructive/10 text-xs text-destructive">
									{broadcastError}
								</div>
							)}
						</>
					)}

					{step === 5 && selectedType && fileData && (
						<BroadcastStep
							publishType={selectedType}
							fileData={fileData}
							name={name}
							description={description}
							fields={metadataFields}
							onSuccess={handleBroadcastSuccess}
							onError={handleBroadcastError}
						/>
					)}

					{step === 6 && result && (
						<SuccessStep result={result} onNavigate={onNavigate} onReset={handleReset} />
					)}
				</div>

				{/* Footer */}
				<WizardFooter
					step={step}
					canNext={canNext}
					onBack={handleBack}
					onNext={handleNext}
				/>
			</div>
		</div>
	)
}
