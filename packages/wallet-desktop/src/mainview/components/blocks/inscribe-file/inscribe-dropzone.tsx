import {
	Code,
	File as FileIcon,
	Image as ImageIcon,
	Music,
	Trash2,
	Upload,
	Video,
} from 'lucide-react'
import {
	type ChangeEvent,
	type DragEvent,
	useCallback,
	useEffect,
	useRef,
	useState,
} from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

/** Supported file categories for preview rendering */
type FileCategory = 'image' | 'video' | 'audio' | 'code' | 'other'

export interface InscribeDropzoneProps {
	/** Currently selected file */
	file: File | null
	/** Callback when a file is selected */
	onFileSelect: (file: File) => void
	/** Callback when the file is removed */
	onFileRemove: () => void
	/** Maximum file size in bytes (default: 10MB) */
	maxFileSize?: number
	/** Optional CSS class name */
	className?: string
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
		case 'other':
			return <FileIcon className={className} />
	}
}

function formatFileSize(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
	return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

export function InscribeDropzone({
	file,
	onFileSelect,
	onFileRemove,
	maxFileSize = 10 * 1024 * 1024,
	className,
}: InscribeDropzoneProps) {
	const [isDragging, setIsDragging] = useState(false)
	const [previewUrl, setPreviewUrl] = useState<string | null>(null)
	const [error, setError] = useState<string | null>(null)
	const previewUrlRef = useRef<string | null>(null)

	// Revoke object URL on unmount to prevent memory leaks
	useEffect(() => {
		return () => {
			if (previewUrlRef.current) {
				URL.revokeObjectURL(previewUrlRef.current)
			}
		}
	}, [])

	const handleFile = useCallback(
		(selectedFile: File) => {
			setError(null)

			if (selectedFile.size > maxFileSize) {
				setError(
					`File too large. Maximum size is ${formatFileSize(maxFileSize)}.`,
				)
				return
			}

			// Revoke previous preview URL before creating new one
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
		[maxFileSize, onFileSelect],
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
			if (droppedFile) {
				handleFile(droppedFile)
			}
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
			if (selectedFile) {
				handleFile(selectedFile)
			}
		},
		[handleFile],
	)

	if (file) {
		const category = categorizeFile(file.type)

		return (
			<div className={cn('flex flex-col gap-3', className)}>
				<Card>
					<CardContent className="flex items-start gap-4 p-4">
						{/* Preview */}
						<div className="relative size-20 flex-shrink-0 overflow-hidden rounded-md border bg-muted">
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
										className="size-8 text-muted-foreground"
									/>
								</div>
							)}
						</div>

						{/* File info */}
						<div className="flex-1 min-w-0 flex flex-col gap-1">
							<p className="text-sm font-medium truncate">{file.name}</p>
							<p className="text-xs text-muted-foreground">
								{file.type || 'Unknown type'}
							</p>
							<p className="text-xs text-muted-foreground">
								{formatFileSize(file.size)}
							</p>
						</div>

						{/* Remove button */}
						<Button
							variant="ghost"
							size="icon"
							onClick={handleRemove}
							className="size-8 text-muted-foreground hover:text-destructive"
							aria-label="Remove file"
						>
							<Trash2 data-icon="inline-start" />
						</Button>
					</CardContent>
				</Card>
			</div>
		)
	}

	return (
		<div className={cn('flex flex-col gap-2', className)}>
			<div
				onDrop={handleDrop}
				onDragOver={handleDragOver}
				onDragLeave={handleDragLeave}
				className={cn(
					'relative flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-8 transition-colors',
					isDragging
						? 'border-primary bg-primary/5'
						: 'border-muted-foreground/25 hover:border-muted-foreground/50',
				)}
			>
				<div className="flex flex-col items-center gap-3 text-center">
					<div className="rounded-full bg-muted p-3">
						<Upload className="size-6 text-muted-foreground" />
					</div>
					<div className="flex flex-col gap-1">
						<p className="text-sm font-medium">
							Drop a file here or click to browse
						</p>
						<p className="text-xs text-muted-foreground">
							Any file type up to {formatFileSize(maxFileSize)}
						</p>
					</div>
					<Label htmlFor="inscribe-file-input" className="sr-only">
						Choose file
					</Label>
					<input
						id="inscribe-file-input"
						type="file"
						className="absolute inset-0 cursor-pointer opacity-0"
						onChange={handleInputChange}
						aria-label="Choose file to inscribe"
					/>
				</div>
			</div>

			{error && (
				<p className="text-sm text-destructive" role="alert">
					{error}
				</p>
			)}
		</div>
	)
}
