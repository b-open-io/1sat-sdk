import {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
	type ChangeEvent,
	type DragEvent,
} from 'react'
import {
	AlertCircle,
	CheckCircle2,
	Code,
	ExternalLink,
	File as FileIcon,
	Image as ImageIcon,
	Loader2,
	Music,
	Plus,
	Trash2,
	Upload,
	Video,
	X,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { rpc } from '../../rpc'

// ---------------------------------------------------------------------------
// Design tokens
// ---------------------------------------------------------------------------

// Section header: 10px uppercase muted tracking-wider (Space Grotesk)
const SECTION_HEADER = 'text-[10px] font-medium uppercase tracking-wider text-muted-foreground'
// Mono data class (JetBrains Mono)
const MONO = 'font-mono'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_FILE_SIZE = 10 * 1024 * 1024

const CONTENT_TYPE_OPTIONS = [
	{ value: 'image/png', label: 'PNG Image' },
	{ value: 'image/jpeg', label: 'JPEG Image' },
	{ value: 'image/gif', label: 'GIF Image' },
	{ value: 'image/svg+xml', label: 'SVG Image' },
	{ value: 'image/webp', label: 'WebP Image' },
	{ value: 'text/plain', label: 'Plain Text' },
	{ value: 'text/html', label: 'HTML' },
	{ value: 'text/markdown', label: 'Markdown' },
	{ value: 'application/json', label: 'JSON' },
	{ value: 'video/mp4', label: 'MP4 Video' },
	{ value: 'audio/mpeg', label: 'MP3 Audio' },
	{ value: 'application/octet-stream', label: 'Binary / Other' },
] as const

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type InscribeTab = 'file' | 'bsv20' | 'bsv21'
type Bsv20Mode = 'mint' | 'deploy'
type FileCategory = 'image' | 'video' | 'audio' | 'code' | 'other'

interface MetadataEntry {
	id: string
	key: string
	value: string
}

interface Bsv20Data {
	mode: Bsv20Mode
	ticker: string
	amount: string
	maxSupply: string
	mintLimit: string
	decimals: string
}

interface Bsv21Data {
	symbol: string
	icon: File | null
	iconPreviewUrl: string | null
	maxSupply: string
	decimals: string
}

interface InscribeResult {
	txid?: string
	error?: string
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatFileSize(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
	return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

function categorizeFile(mimeType: string): FileCategory {
	if (mimeType.startsWith('image/')) return 'image'
	if (mimeType.startsWith('video/')) return 'video'
	if (mimeType.startsWith('audio/')) return 'audio'
	if (
		mimeType.startsWith('text/') ||
		mimeType === 'application/json' ||
		mimeType === 'application/javascript'
	)
		return 'code'
	return 'other'
}

function estimateFee(fileSize: number): number {
	return 50 + Math.ceil(fileSize * 0.5)
}

function generateId(): string {
	return `meta-${Math.random().toString(36).slice(2, 9)}-${Date.now()}`
}

function fileToBase64(file: File): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader()
		reader.onload = () => {
			const result = reader.result
			if (typeof result !== 'string') {
				reject(new Error('Failed to read file'))
				return
			}
			const base64 = result.split(',')[1]
			if (!base64) {
				reject(new Error('Failed to encode file as base64'))
				return
			}
			resolve(base64)
		}
		reader.onerror = () => reject(new Error('Failed to read file'))
		reader.readAsDataURL(file)
	})
}

// ---------------------------------------------------------------------------
// FileCategoryIcon
// ---------------------------------------------------------------------------

function FileCategoryIcon({
	category,
	className,
}: {
	category: FileCategory
	className?: string
}) {
	switch (category) {
		case 'image':
			return <ImageIcon className={className} />
		case 'video':
			return <Video className={className} />
		case 'audio':
			return <Music className={className} />
		case 'code':
			return <Code className={className} />
		default:
			return <FileIcon className={className} />
	}
}

// ---------------------------------------------------------------------------
// Dropzone
// ---------------------------------------------------------------------------

interface DropzoneProps {
	file: File | null
	onFileSelect: (file: File) => void
	onFileRemove: () => void
}

function Dropzone({ file, onFileSelect, onFileRemove }: DropzoneProps) {
	const [isDragging, setIsDragging] = useState(false)
	const [previewUrl, setPreviewUrl] = useState<string | null>(null)
	const [error, setError] = useState<string | null>(null)
	const previewUrlRef = useRef<string | null>(null)

	useEffect(() => {
		return () => {
			if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current)
		}
	}, [])

	const handleFile = useCallback(
		(selectedFile: File) => {
			setError(null)
			if (selectedFile.size > MAX_FILE_SIZE) {
				setError(`File too large. Maximum size is ${formatFileSize(MAX_FILE_SIZE)}.`)
				return
			}
			if (previewUrlRef.current) {
				URL.revokeObjectURL(previewUrlRef.current)
				previewUrlRef.current = null
			}
			if (selectedFile.type.startsWith('image/')) {
				const url = URL.createObjectURL(selectedFile)
				previewUrlRef.current = url
				setPreviewUrl(url)
			} else {
				setPreviewUrl(null)
			}
			onFileSelect(selectedFile)
		},
		[onFileSelect],
	)

	const handleRemove = useCallback(() => {
		if (previewUrlRef.current) {
			URL.revokeObjectURL(previewUrlRef.current)
			previewUrlRef.current = null
		}
		setPreviewUrl(null)
		setError(null)
		onFileRemove()
	}, [onFileRemove])

	const handleDrop = useCallback(
		(e: DragEvent<HTMLDivElement>) => {
			e.preventDefault()
			setIsDragging(false)
			const droppedFile = e.dataTransfer.files[0]
			if (droppedFile) handleFile(droppedFile)
		},
		[handleFile],
	)

	const handleDragOver = useCallback((e: DragEvent<HTMLDivElement>) => {
		e.preventDefault()
		setIsDragging(true)
	}, [])

	const handleDragLeave = useCallback((e: DragEvent<HTMLDivElement>) => {
		e.preventDefault()
		setIsDragging(false)
	}, [])

	const handleInputChange = useCallback(
		(e: ChangeEvent<HTMLInputElement>) => {
			const selectedFile = e.target.files?.[0]
			if (selectedFile) handleFile(selectedFile)
		},
		[handleFile],
	)

	if (file) {
		const category = categorizeFile(file.type)
		return (
			<div className="flex flex-col gap-3">
				<div className="flex items-start gap-4 border border-border px-4 py-3">
					<div className="relative size-16 flex-shrink-0 overflow-hidden border border-border bg-muted">
						{previewUrl ? (
							<img
								src={previewUrl}
								alt="File preview"
								className="h-full w-full object-cover"
							/>
						) : (
							<div className="flex h-full w-full items-center justify-center">
								<FileCategoryIcon
									category={category}
									className="size-6 text-muted-foreground"
								/>
							</div>
						)}
					</div>
					<div className="flex-1 min-w-0 flex flex-col gap-0.5">
						<p className="text-sm font-medium truncate">{file.name}</p>
						<p className={`text-[11px] text-muted-foreground ${MONO}`}>
							{file.type || 'unknown'}
						</p>
						<p className={`text-[11px] text-muted-foreground ${MONO}`}>
							{formatFileSize(file.size)}
						</p>
					</div>
					<Button
						variant="ghost"
						size="icon"
						onClick={handleRemove}
						className="size-8 text-muted-foreground hover:text-destructive"
						aria-label="Remove file"
					>
						<Trash2 className="size-4" />
					</Button>
				</div>
			</div>
		)
	}

	return (
		<div className="flex flex-col gap-2">
			<div
				onDrop={handleDrop}
				onDragOver={handleDragOver}
				onDragLeave={handleDragLeave}
				className={[
					'relative flex flex-col items-center justify-center border border-dashed p-8 transition-colors',
					isDragging
						? 'border-primary bg-primary/5'
						: 'border-muted-foreground/30 hover:border-muted-foreground/60',
				].join(' ')}
			>
				<div className="flex flex-col items-center gap-3 text-center">
					<Upload className="size-8 text-muted-foreground" />
					<div className="flex flex-col gap-1">
						<p className="text-sm font-medium">Drop a file here or click to browse</p>
						<p className="text-xs text-muted-foreground">
							Any file type up to {formatFileSize(MAX_FILE_SIZE)}
						</p>
					</div>
					<input
						type="file"
						className="absolute inset-0 cursor-pointer opacity-0"
						onChange={handleInputChange}
						aria-label="Choose file to inscribe"
					/>
				</div>
			</div>
			{error && (
				<p className="text-xs text-destructive" role="alert">
					{error}
				</p>
			)}
		</div>
	)
}

// ---------------------------------------------------------------------------
// File Tab content
// ---------------------------------------------------------------------------

interface FileTabProps {
	file: File | null
	onFileSelect: (file: File) => void
	onFileRemove: () => void
	contentType: string
	onContentTypeChange: (ct: string) => void
	signWithBAP: boolean
	onSignWithBAPChange: (v: boolean) => void
	metadata: MetadataEntry[]
	onMetadataChange: (m: MetadataEntry[]) => void
}

function FileTab({
	file,
	onFileSelect,
	onFileRemove,
	contentType,
	onContentTypeChange,
	signWithBAP,
	onSignWithBAPChange,
	metadata,
	onMetadataChange,
}: FileTabProps) {
	const handleAddMetadata = useCallback(() => {
		const entries = [...metadata]
		if (
			entries.length === 0 &&
			file?.name &&
			!entries.some((m) => m.key === 'name')
		) {
			entries.push({ id: generateId(), key: 'name', value: file.name })
		}
		entries.push({ id: generateId(), key: '', value: '' })
		onMetadataChange(entries)
	}, [metadata, onMetadataChange, file])

	const handleUpdateMetadata = useCallback(
		(id: string, field: 'key' | 'value', value: string) => {
			onMetadataChange(
				metadata.map((entry) =>
					entry.id !== id
						? entry
						: {
								...entry,
								[field]:
									field === 'key' ? value.replace(/[^a-zA-Z0-9]/g, '') : value,
							},
				),
			)
		},
		[metadata, onMetadataChange],
	)

	const handleRemoveMetadata = useCallback(
		(id: string) => {
			onMetadataChange(metadata.filter((entry) => entry.id !== id))
		},
		[metadata, onMetadataChange],
	)

	return (
		<div className="flex flex-col gap-6 pt-4">
			<Dropzone file={file} onFileSelect={onFileSelect} onFileRemove={onFileRemove} />

			{file && (
				<>
					{/* Content type */}
					<div className="flex flex-col gap-2">
						<p className={SECTION_HEADER}>Content Type</p>
						<Select value={contentType} onValueChange={onContentTypeChange}>
							<SelectTrigger className="rounded-none">
								<SelectValue placeholder="Select content type" />
							</SelectTrigger>
							<SelectContent>
								{CONTENT_TYPE_OPTIONS.map((opt) => (
									<SelectItem key={opt.value} value={opt.value}>
										<span className={`text-xs ${MONO}`}>{opt.value}</span>
									</SelectItem>
								))}
							</SelectContent>
						</Select>
						<p className="text-xs text-muted-foreground">
							Auto-detected from file. Override if needed.
						</p>
					</div>

					{/* BAP signing */}
					<div className="flex items-center gap-3 border border-border px-4 py-3">
						<Checkbox
							id="bap-signing"
							checked={signWithBAP}
							onCheckedChange={(checked) => {
								if (typeof checked === 'boolean') onSignWithBAPChange(checked)
							}}
						/>
						<div className="flex flex-col gap-0.5">
							<Label
								htmlFor="bap-signing"
								className="cursor-pointer text-sm font-medium"
							>
								Sign with BAP identity (Sigma)
							</Label>
							<p className="text-xs text-muted-foreground">
								Attach a cryptographic identity proof to this inscription.
							</p>
						</div>
					</div>

					{/* MAP metadata */}
					<div className="flex flex-col gap-3">
						<div className="flex items-center justify-between">
							<p className={SECTION_HEADER}>MAP Metadata</p>
							<Button
								type="button"
								size="sm"
								variant="outline"
								onClick={handleAddMetadata}
								className="h-7 gap-1 rounded-none text-xs"
							>
								<Plus className="size-3" />
								Add Field
							</Button>
						</div>

						{metadata.length === 0 ? (
							<div className="border border-dashed border-muted-foreground/30 py-4 text-center text-xs text-muted-foreground">
								No metadata. Click "Add Field" to attach key/value pairs.
							</div>
						) : (
							<div className="flex flex-col gap-2">
								{metadata.map((entry) => (
									<div key={entry.id} className="flex items-center gap-2">
										<Input
											placeholder="Key"
											value={entry.key}
											onChange={(e) =>
												handleUpdateMetadata(entry.id, 'key', e.target.value)
											}
											className={`flex-1 rounded-none ${MONO} text-xs`}
											aria-label="Metadata key"
										/>
										<Input
											placeholder="Value"
											value={entry.value}
											onChange={(e) =>
												handleUpdateMetadata(entry.id, 'value', e.target.value)
											}
											className="flex-1 rounded-none text-xs"
											aria-label="Metadata value"
										/>
										<Button
											type="button"
											size="icon"
											variant="ghost"
											onClick={() => handleRemoveMetadata(entry.id)}
											className="size-9 flex-shrink-0 rounded-none text-muted-foreground hover:text-destructive"
											aria-label="Remove metadata field"
										>
											<X className="size-4" />
										</Button>
									</div>
								))}
							</div>
						)}
					</div>
				</>
			)}
		</div>
	)
}

// ---------------------------------------------------------------------------
// BSV20 Tab
// ---------------------------------------------------------------------------

interface Bsv20TabProps {
	data: Bsv20Data
	onChange: (data: Bsv20Data) => void
}

function Bsv20Tab({ data, onChange }: Bsv20TabProps) {
	const update = useCallback(
		<K extends keyof Bsv20Data>(field: K, value: Bsv20Data[K]) => {
			onChange({ ...data, [field]: value })
		},
		[data, onChange],
	)

	return (
		<div className="flex flex-col gap-5 pt-4">
			{/* Mode */}
			<div className="flex flex-col gap-2">
				<p className={SECTION_HEADER}>Mode</p>
				<div className="flex border border-border">
					<button
						type="button"
						onClick={() => update('mode', 'mint')}
						className={[
							'flex-1 py-2 text-xs font-medium transition-colors',
							data.mode === 'mint'
								? 'bg-foreground text-background'
								: 'bg-background text-muted-foreground hover:text-foreground',
						].join(' ')}
					>
						Mint
					</button>
					<button
						type="button"
						onClick={() => update('mode', 'deploy')}
						className={[
							'flex-1 py-2 text-xs font-medium transition-colors border-l border-border',
							data.mode === 'deploy'
								? 'bg-foreground text-background'
								: 'bg-background text-muted-foreground hover:text-foreground',
						].join(' ')}
					>
						Deploy
					</button>
				</div>
				<p className="text-xs text-muted-foreground">
					{data.mode === 'mint'
						? 'Mint tokens from an existing BSV20 ticker.'
						: 'Deploy a new BSV20 ticker to the blockchain.'}
				</p>
			</div>

			{/* Ticker */}
			<div className="flex flex-col gap-2">
				<Label htmlFor="bsv20-ticker" className={SECTION_HEADER}>
					Ticker
				</Label>
				<Input
					id="bsv20-ticker"
					placeholder="e.g. PEPE"
					value={data.ticker}
					onChange={(e) =>
						update(
							'ticker',
							e.target.value
								.toUpperCase()
								.replace(/[^A-Z0-9]/g, '')
								.slice(0, 4),
						)
					}
					maxLength={4}
					className={`rounded-none ${MONO}`}
				/>
				<p className="text-xs text-muted-foreground">Up to 4 uppercase characters.</p>
			</div>

			{data.mode === 'mint' ? (
				<div className="flex flex-col gap-2">
					<Label htmlFor="bsv20-amount" className={SECTION_HEADER}>
						Amount
					</Label>
					<Input
						id="bsv20-amount"
						type="text"
						inputMode="numeric"
						placeholder="1000"
						value={data.amount}
						onChange={(e) =>
							update('amount', e.target.value.replace(/[^0-9]/g, ''))
						}
						className={`rounded-none ${MONO}`}
					/>
				</div>
			) : (
				<>
					<div className="flex flex-col gap-2">
						<Label htmlFor="bsv20-max" className={SECTION_HEADER}>
							Max Supply
						</Label>
						<Input
							id="bsv20-max"
							type="text"
							inputMode="numeric"
							placeholder="21000000"
							value={data.maxSupply}
							onChange={(e) =>
								update('maxSupply', e.target.value.replace(/[^0-9]/g, ''))
							}
							className={`rounded-none ${MONO}`}
						/>
					</div>
					<div className="flex flex-col gap-2">
						<Label htmlFor="bsv20-limit" className={SECTION_HEADER}>
							Mint Limit
						</Label>
						<Input
							id="bsv20-limit"
							type="text"
							inputMode="numeric"
							placeholder="1000"
							value={data.mintLimit}
							onChange={(e) =>
								update('mintLimit', e.target.value.replace(/[^0-9]/g, ''))
							}
							className={`rounded-none ${MONO}`}
						/>
						<p className="text-xs text-muted-foreground">
							Max tokens per mint transaction.
						</p>
					</div>
					<div className="flex flex-col gap-2">
						<Label htmlFor="bsv20-decimals" className={SECTION_HEADER}>
							Decimals
						</Label>
						<Input
							id="bsv20-decimals"
							type="text"
							inputMode="numeric"
							placeholder="0"
							value={data.decimals}
							onChange={(e) =>
								update('decimals', e.target.value.replace(/[^0-9]/g, ''))
							}
							className={`rounded-none ${MONO}`}
						/>
					</div>
				</>
			)}
		</div>
	)
}

// ---------------------------------------------------------------------------
// BSV21 Tab
// ---------------------------------------------------------------------------

interface Bsv21TabProps {
	data: Bsv21Data
	onChange: (data: Bsv21Data) => void
}

function Bsv21Tab({ data, onChange }: Bsv21TabProps) {
	const lastPreviewRef = useRef<string | null>(null)

	useEffect(() => {
		lastPreviewRef.current = data.iconPreviewUrl
	}, [data.iconPreviewUrl])

	useEffect(() => {
		return () => {
			if (lastPreviewRef.current) URL.revokeObjectURL(lastPreviewRef.current)
		}
	}, [])

	const update = useCallback(
		<K extends keyof Bsv21Data>(field: K, value: Bsv21Data[K]) => {
			onChange({ ...data, [field]: value })
		},
		[data, onChange],
	)

	const handleIconSelect = useCallback(
		(e: ChangeEvent<HTMLInputElement>) => {
			const selected = e.target.files?.[0]
			if (!selected) return
			if (!selected.type.startsWith('image/')) return
			if (data.iconPreviewUrl) URL.revokeObjectURL(data.iconPreviewUrl)
			const url = URL.createObjectURL(selected)
			onChange({ ...data, icon: selected, iconPreviewUrl: url })
		},
		[data, onChange],
	)

	const handleIconRemove = useCallback(() => {
		if (data.iconPreviewUrl) URL.revokeObjectURL(data.iconPreviewUrl)
		onChange({ ...data, icon: null, iconPreviewUrl: null })
	}, [data, onChange])

	return (
		<div className="flex flex-col gap-5 pt-4">
			<p className="text-xs text-muted-foreground">
				Deploy a new BSV21 token. All tokens are minted to your wallet on deployment.
			</p>

			{/* Symbol */}
			<div className="flex flex-col gap-2">
				<div className="flex items-center justify-between">
					<Label htmlFor="bsv21-symbol" className={SECTION_HEADER}>
						Symbol
					</Label>
					<span className="text-[10px] text-muted-foreground">
						Does not need to be unique
					</span>
				</div>
				<Input
					id="bsv21-symbol"
					placeholder="e.g. MYTOKEN"
					value={data.symbol}
					maxLength={255}
					onKeyDown={(e) => {
						if (e.key === ' ') e.preventDefault()
					}}
					onChange={(e) => update('symbol', e.target.value.replace(/\s/g, ''))}
					className={`rounded-none ${MONO}`}
				/>
			</div>

			{/* Max Supply */}
			<div className="flex flex-col gap-2">
				<div className="flex items-center justify-between">
					<Label htmlFor="bsv21-max" className={SECTION_HEADER}>
						Max Supply
					</Label>
					<span className="text-[10px] text-muted-foreground">Whole tokens</span>
				</div>
				<Input
					id="bsv21-max"
					type="text"
					inputMode="numeric"
					placeholder="21000000"
					value={data.maxSupply}
					onChange={(e) => update('maxSupply', e.target.value.replace(/[^0-9]/g, ''))}
					className={`rounded-none ${MONO}`}
				/>
			</div>

			{/* Decimals */}
			<div className="flex flex-col gap-2">
				<div className="flex items-center justify-between">
					<Label htmlFor="bsv21-decimals" className={SECTION_HEADER}>
						Decimal Precision
					</Label>
					<span className="text-[10px] text-muted-foreground">Default: 8</span>
				</div>
				<Input
					id="bsv21-decimals"
					type="text"
					inputMode="numeric"
					placeholder="8"
					value={data.decimals}
					onChange={(e) => update('decimals', e.target.value.replace(/[^0-9]/g, ''))}
					className={`rounded-none ${MONO}`}
				/>
			</div>

			{/* Icon upload */}
			<div className="flex flex-col gap-2">
				<div className="flex items-center justify-between">
					<p className={SECTION_HEADER}>Token Icon</p>
					<span className="text-[10px] text-muted-foreground">
						Square image recommended
					</span>
				</div>
				<div className="flex items-center gap-4">
					{data.iconPreviewUrl ? (
						<div className="relative size-16 flex-shrink-0 overflow-hidden border border-border bg-muted">
							<img
								src={data.iconPreviewUrl}
								alt="Token icon preview"
								className="h-full w-full object-cover"
							/>
							<button
								type="button"
								onClick={handleIconRemove}
								className="absolute right-0.5 top-0.5 size-5 flex items-center justify-center bg-destructive text-destructive-foreground hover:bg-destructive/80"
								aria-label="Remove icon"
							>
								<X className="size-3" />
							</button>
						</div>
					) : (
						<div className="flex size-16 flex-shrink-0 items-center justify-center border border-dashed border-muted-foreground/30 bg-muted/50">
							<ImageIcon className="size-6 text-muted-foreground/50" />
						</div>
					)}

					<div className="flex-1">
						<Label
							htmlFor="bsv21-icon-input"
							className="flex h-9 w-full cursor-pointer items-center justify-center gap-2 border border-border text-xs transition-colors hover:bg-muted/50"
						>
							<Upload className="size-3.5" />
							{data.icon ? 'Change Icon' : 'Select Image'}
						</Label>
						<input
							type="file"
							id="bsv21-icon-input"
							accept="image/*"
							className="sr-only"
							onChange={handleIconSelect}
						/>
					</div>
				</div>
			</div>

			<div className="border border-border bg-muted/30 px-4 py-3 text-xs text-muted-foreground">
				BSV21 deployments are indexed immediately. A listing fee may be required before
				it appears in some marketplace interfaces.
			</div>
		</div>
	)
}

// ---------------------------------------------------------------------------
// InscribeView
// ---------------------------------------------------------------------------

function createDefaultBsv20(): Bsv20Data {
	return {
		mode: 'mint',
		ticker: '',
		amount: '',
		maxSupply: '21000000',
		mintLimit: '1000',
		decimals: '0',
	}
}

function createDefaultBsv21(): Bsv21Data {
	return {
		symbol: '',
		icon: null,
		iconPreviewUrl: null,
		maxSupply: '21000000',
		decimals: '8',
	}
}

export function InscribeView() {
	const [activeTab, setActiveTab] = useState<InscribeTab>('file')

	// File tab state
	const [file, setFile] = useState<File | null>(null)
	const [contentType, setContentType] = useState('application/octet-stream')
	const [signWithBAP, setSignWithBAP] = useState(false)
	const [metadata, setMetadata] = useState<MetadataEntry[]>([])

	// BSV20 tab state
	const [bsv20, setBsv20] = useState<Bsv20Data>(createDefaultBsv20)

	// BSV21 tab state
	const [bsv21, setBsv21] = useState<Bsv21Data>(createDefaultBsv21)

	// Shared
	const [isInscribing, setIsInscribing] = useState(false)
	const [result, setResult] = useState<InscribeResult | null>(null)
	const [error, setError] = useState<string | null>(null)

	const feeEstimate = useMemo(() => {
		if (activeTab === 'file' && file) return estimateFee(file.size)
		if (activeTab === 'bsv20') return estimateFee(200)
		if (activeTab === 'bsv21') return estimateFee(200 + (bsv21.icon?.size ?? 0))
		return 0
	}, [activeTab, file, bsv21.icon])

	const canInscribe = useMemo(() => {
		if (activeTab === 'file') return file !== null
		if (activeTab === 'bsv20') return bsv20.ticker.length > 0
		if (activeTab === 'bsv21')
			return bsv21.symbol.length > 0 && bsv21.icon !== null && bsv21.maxSupply.length > 0
		return false
	}, [activeTab, file, bsv20.ticker, bsv21])

	const buttonLabel = useMemo(() => {
		if (activeTab === 'bsv20') return bsv20.mode === 'mint' ? 'Mint Tokens' : 'Deploy Ticker'
		if (activeTab === 'bsv21') return 'Deploy Token'
		return 'Inscribe on Chain'
	}, [activeTab, bsv20.mode])

	const handleFileSelect = useCallback((selected: File) => {
		setFile(selected)
		setContentType(selected.type || 'application/octet-stream')
		setResult(null)
		setError(null)
	}, [])

	const handleFileRemove = useCallback(() => {
		setFile(null)
		setContentType('application/octet-stream')
		setMetadata([])
		setResult(null)
		setError(null)
	}, [])

	const handleInscribe = useCallback(async () => {
		setIsInscribing(true)
		setError(null)
		setResult(null)

		try {
			if (activeTab === 'file') {
				if (!file) return
				const base64Content = await fileToBase64(file)
				const map: Record<string, string> = {}
				for (const entry of metadata) {
					if (entry.key.trim() && entry.value.trim()) {
						map[entry.key.trim()] = entry.value.trim()
					}
				}
				const res = await rpc.request.inscribeFile({
					base64Content,
					contentType,
					map: Object.keys(map).length > 0 ? map : undefined,
				})
				if (res.error) {
					setError(res.error)
				} else {
					setResult(res)
				}
				return
			}

			// BSV20 and BSV21 not yet supported via desktop RPC
			setError(
				`${activeTab.toUpperCase()} inscriptions are not yet supported in the desktop wallet.`,
			)
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Inscription failed')
		} finally {
			setIsInscribing(false)
		}
	}, [activeTab, file, contentType, metadata, signWithBAP])

	const handleTabChange = useCallback((value: string) => {
		if (value === 'file' || value === 'bsv20' || value === 'bsv21') {
			setActiveTab(value)
			setResult(null)
			setError(null)
		}
	}, [])

	return (
		<div className="p-6 max-w-[600px]">
			<p className={`${SECTION_HEADER} mb-4`}>Inscribe</p>

			<div className="border border-border">
				{/* Tabs header */}
				<Tabs value={activeTab} onValueChange={handleTabChange}>
					<TabsList className="grid w-full grid-cols-3 rounded-none border-b border-border bg-background h-auto p-0">
						{(['file', 'bsv20', 'bsv21'] as const).map((tab) => (
							<TabsTrigger
								key={tab}
								value={tab}
								className="rounded-none border-r border-border py-2.5 text-xs font-medium uppercase tracking-wide last:border-r-0 data-[state=active]:bg-muted data-[state=active]:shadow-none"
							>
								{tab === 'file' ? 'File' : tab === 'bsv20' ? 'BSV20' : 'BSV21'}
							</TabsTrigger>
						))}
					</TabsList>

					<div className="px-6 pb-6">
						<TabsContent value="file" className="mt-0">
							<FileTab
								file={file}
								onFileSelect={handleFileSelect}
								onFileRemove={handleFileRemove}
								contentType={contentType}
								onContentTypeChange={setContentType}
								signWithBAP={signWithBAP}
								onSignWithBAPChange={setSignWithBAP}
								metadata={metadata}
								onMetadataChange={setMetadata}
							/>
						</TabsContent>

						<TabsContent value="bsv20" className="mt-0">
							<Bsv20Tab data={bsv20} onChange={setBsv20} />
						</TabsContent>

						<TabsContent value="bsv21" className="mt-0">
							<Bsv21Tab data={bsv21} onChange={setBsv21} />
						</TabsContent>

						{/* Fee estimate */}
						{feeEstimate > 0 && (
							<>
								<Separator className="my-5" />
								<div className="flex items-center justify-between">
									<span className="text-xs text-muted-foreground">
										Estimated fee
									</span>
									<span className={`text-xs font-medium ${MONO}`}>
										~{feeEstimate.toLocaleString()} sats
									</span>
								</div>
							</>
						)}

						{/* Success */}
						{result?.txid && (
							<>
								<Separator className="my-5" />
								<div className="flex items-start gap-3 border border-primary/20 bg-primary/5 px-4 py-3">
									<CheckCircle2 className="mt-0.5 size-4 flex-shrink-0 text-primary" />
									<div className="min-w-0 flex flex-col gap-1">
										<p className="text-xs font-medium">Inscription created</p>
										<a
											href={`https://whatsonchain.com/tx/${result.txid}`}
											target="_blank"
											rel="noopener noreferrer"
											className="inline-flex items-center gap-1 transition-colors hover:text-foreground"
										>
											<span
												className={`text-[10px] text-muted-foreground truncate max-w-[300px] ${MONO}`}
											>
												{result.txid}
											</span>
											<ExternalLink className="size-3 flex-shrink-0" />
										</a>
									</div>
								</div>
							</>
						)}

						{/* Error */}
						{error && (
							<>
								<Separator className="my-5" />
								<div className="flex items-start gap-3 border border-destructive/20 bg-destructive/5 px-4 py-3">
									<AlertCircle className="mt-0.5 size-4 flex-shrink-0 text-destructive" />
									<div className="flex flex-col gap-1">
										<p className="text-xs font-medium">Inscription failed</p>
										<p className="text-xs text-muted-foreground">{error}</p>
									</div>
								</div>
							</>
						)}

						{/* Submit */}
						<div className="mt-6">
							<Button
								className="w-full rounded-none"
								onClick={handleInscribe}
								disabled={!canInscribe || isInscribing}
								aria-busy={isInscribing}
							>
								{isInscribing ? (
									<>
										<Loader2 className="size-4 animate-spin" />
										Inscribing...
									</>
								) : (
									buttonLabel
								)}
							</Button>
						</div>
					</div>
				</Tabs>
			</div>
		</div>
	)
}
