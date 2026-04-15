import { Button } from '@/components/ui/button'
import {
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'
import { Gem, ImageOff, Link, Loader2, Upload } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { STACK_URL } from '../../../../shared/constants'
import type { OrdinalInfo } from '../../../../shared/types'
import { rpc } from '../../../rpc'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ImageSourceTab = 'url' | 'ordinals' | 'upload'

export interface ImageSelectionModalProps {
	open: boolean
	onOpenChange: (open: boolean) => void
	onImageSelected: (imageUrl: string) => void
	title?: string
	aspectRatio?: number
}

// ---------------------------------------------------------------------------
// Tag helper
// ---------------------------------------------------------------------------

function getTag(tags: string[], prefix: string): string | undefined {
	const tag = tags.find((t) => t.startsWith(prefix))
	return tag ? tag.slice(prefix.length) : undefined
}

// ---------------------------------------------------------------------------
// URL Tab
// ---------------------------------------------------------------------------

interface UrlTabContentProps {
	urlInput: string
	onUrlChange: (value: string) => void
	previewLoading: boolean
	previewImageUrl: string | null
	aspectRatio: number
}

function UrlTabContent({
	urlInput,
	onUrlChange,
	previewLoading,
	previewImageUrl,
	aspectRatio,
}: UrlTabContentProps) {
	const [imgError, setImgError] = useState(false)

	// Reset error when URL changes
	useEffect(() => {
		setImgError(false)
	}, [previewImageUrl])

	const aspectClass = aspectRatio >= 2 ? 'aspect-video' : 'aspect-square'

	return (
		<TabsContent className="flex-1 space-y-4 overflow-auto" value="url">
			<div className="space-y-2">
				<Label htmlFor="image-url">Image URL</Label>
				<Input
					id="image-url"
					onChange={(e) => onUrlChange(e.target.value)}
					placeholder="https://example.com/image.jpg or txid_vout"
					type="url"
					value={urlInput}
				/>
				<p className="text-xs text-muted-foreground">
					Enter a URL or an on-chain outpoint (txid_vout)
				</p>
			</div>

			<div
				className={cn(
					'relative flex min-h-[200px] items-center justify-center rounded-md border bg-muted/50',
					aspectClass,
				)}
			>
				{previewLoading && !previewImageUrl && (
					<Loader2 className="size-8 animate-spin text-primary" />
				)}
				{previewImageUrl && !imgError ? (
					<img
						alt="URL Preview"
						className="h-full w-full rounded-md object-contain"
						src={previewImageUrl}
						onError={() => setImgError(true)}
						onLoad={() => {
							// no-op, just confirms it loaded
						}}
					/>
				) : imgError ? (
					<div className="flex flex-col items-center gap-2 text-muted-foreground">
						<ImageOff className="size-8" />
						<span className="text-sm">Failed to load image</span>
					</div>
				) : (
					!previewLoading && (
						<span className="text-muted-foreground">
							Enter a valid image URL to preview
						</span>
					)
				)}
			</div>
		</TabsContent>
	)
}

// ---------------------------------------------------------------------------
// Ordinals Tab
// ---------------------------------------------------------------------------

interface OrdinalsTabContentProps {
	ordinals: OrdinalInfo[]
	loading: boolean
	error: string | null
	aspectRatio: number
	onSelect: (outpoint: string) => void
}

function OrdinalsTabContent({
	ordinals,
	loading,
	error,
	aspectRatio,
	onSelect,
}: OrdinalsTabContentProps) {
	const gridCols =
		aspectRatio >= 2
			? 'grid-cols-2 sm:grid-cols-3'
			: 'grid-cols-3 sm:grid-cols-4'
	const aspectClass = aspectRatio >= 2 ? 'aspect-video' : 'aspect-square'

	if (loading) {
		return (
			<TabsContent
				className="flex flex-1 flex-col gap-4 overflow-auto"
				value="ordinals"
			>
				<div className={cn('grid gap-2', gridCols)}>
					{Array.from({ length: 8 }, (_, i) => (
						<Skeleton
							key={`skel-${i}`}
							className={cn('w-full rounded-md', aspectClass)}
						/>
					))}
				</div>
			</TabsContent>
		)
	}

	if (error) {
		return (
			<TabsContent
				className="flex flex-1 flex-col items-center justify-center gap-2"
				value="ordinals"
			>
				<p className="text-sm text-destructive">{error}</p>
			</TabsContent>
		)
	}

	const imageOrdinals = ordinals.filter((o) => {
		const ct = getTag(o.tags, 'type:') ?? ''
		return ct.startsWith('image/')
	})

	if (imageOrdinals.length === 0) {
		return (
			<TabsContent
				className="flex flex-1 flex-col items-center justify-center gap-2 py-8"
				value="ordinals"
			>
				<div className="flex size-12 items-center justify-center rounded-full bg-muted">
					<Gem className="size-6 text-muted-foreground" aria-hidden="true" />
				</div>
				<p className="text-sm text-muted-foreground">
					No image ordinals found in your wallet
				</p>
			</TabsContent>
		)
	}

	return (
		<TabsContent
			className="flex flex-1 flex-col gap-4 overflow-hidden"
			value="ordinals"
		>
			<Label className="text-sm text-muted-foreground">
				{imageOrdinals.length} image ordinal
				{imageOrdinals.length !== 1 ? 's' : ''}
			</Label>
			<ScrollArea className="flex-1" style={{ maxHeight: '400px' }}>
				<div className={cn('grid gap-2', gridCols)}>
					{imageOrdinals.map((o) => (
						<OrdinalThumbnailButton
							key={o.outpoint}
							ordinal={o}
							aspectClass={aspectClass}
							onSelect={onSelect}
						/>
					))}
				</div>
			</ScrollArea>
		</TabsContent>
	)
}

// ---------------------------------------------------------------------------
// Ordinal thumbnail button
// ---------------------------------------------------------------------------

interface OrdinalThumbnailButtonProps {
	ordinal: OrdinalInfo
	aspectClass: string
	onSelect: (outpoint: string) => void
}

function OrdinalThumbnailButton({
	ordinal,
	aspectClass,
	onSelect,
}: OrdinalThumbnailButtonProps) {
	const [imgError, setImgError] = useState(false)
	const [imgLoading, setImgLoading] = useState(true)
	const contentUrl = `${STACK_URL}/content/${ordinal.outpoint}`
	const name = getTag(ordinal.tags, 'name:')
	const displayName = name ?? `${ordinal.outpoint.slice(0, 8)}...`

	return (
		<button
			className={cn(
				'group relative cursor-pointer overflow-hidden rounded-md bg-muted',
				aspectClass,
			)}
			onClick={() => onSelect(ordinal.outpoint)}
			title={displayName}
			type="button"
		>
			{imgLoading && !imgError && (
				<Skeleton className="absolute inset-0 h-full w-full rounded-none" />
			)}
			{imgError ? (
				<div className="flex h-full w-full items-center justify-center">
					<ImageOff className="size-6 text-muted-foreground/50" />
				</div>
			) : (
				<img
					src={contentUrl}
					alt={displayName}
					className={cn(
						'h-full w-full object-cover ring-primary ring-offset-2 transition group-hover:ring-2',
						imgLoading && 'invisible',
					)}
					loading="lazy"
					onError={() => {
						setImgError(true)
						setImgLoading(false)
					}}
					onLoad={() => setImgLoading(false)}
				/>
			)}
			{name && (
				<div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent px-1.5 pb-1 pt-4">
					<span className="truncate text-xs font-medium text-white">
						{name}
					</span>
				</div>
			)}
		</button>
	)
}

// ---------------------------------------------------------------------------
// Upload Tab
// ---------------------------------------------------------------------------

interface UploadTabContentProps {
	uploadPreview: string | null
	uploadFilename: string | null
	uploading: boolean
	aspectRatio: number
	onPickFile: () => void
	onClear: () => void
}

function UploadTabContent({
	uploadPreview,
	uploadFilename,
	uploading,
	aspectRatio,
	onPickFile,
	onClear,
}: UploadTabContentProps) {
	const aspectClass = aspectRatio >= 2 ? 'aspect-video' : 'aspect-square'

	return (
		<TabsContent className="flex-1 space-y-4 overflow-auto" value="upload">
			{uploadPreview ? (
				<div className="space-y-3">
					<div
						className={cn(
							'relative flex items-center justify-center rounded-md border bg-muted/50 overflow-hidden',
							aspectClass,
						)}
					>
						<img
							src={uploadPreview}
							alt={uploadFilename ?? 'Uploaded image'}
							className="h-full w-full object-contain"
						/>
					</div>
					<div className="flex items-center justify-between">
						<span className="truncate text-sm text-muted-foreground">
							{uploadFilename}
						</span>
						<Button variant="outline" size="sm" onClick={onClear}>
							Clear
						</Button>
					</div>
				</div>
			) : (
				<button
					type="button"
					onClick={onPickFile}
					disabled={uploading}
					className={cn(
						'flex h-64 w-full cursor-pointer flex-col items-center justify-center gap-3 rounded-md border-2 border-dashed border-border p-8 text-center transition-colors hover:border-primary hover:bg-muted/50',
						uploading && 'pointer-events-none opacity-50',
					)}
				>
					{uploading ? (
						<Loader2 className="size-8 animate-spin text-primary" />
					) : (
						<>
							<Upload className="size-8 text-muted-foreground" />
							<p className="text-muted-foreground">
								Click to select an image file
							</p>
							<p className="text-xs text-muted-foreground/70">
								PNG, JPG, GIF, WebP, or SVG
							</p>
						</>
					)}
				</button>
			)}
		</TabsContent>
	)
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Resolve a user-entered URL to a previewable src */
function resolvePreviewUrl(input: string): string | null {
	if (!input.trim()) return null

	// Full URL
	if (input.startsWith('http://') || input.startsWith('https://')) {
		return input
	}

	// Data URL
	if (input.startsWith('data:')) {
		return input
	}

	// Outpoint pattern: 64-char hex optionally followed by _N or .N
	const outpointRe = /^[0-9a-fA-F]{64}[_.]?\d*$/
	if (outpointRe.test(input.trim())) {
		return `${STACK_URL}/content/${input.trim()}`
	}

	// Slash-prefixed outpoint (e.g. /txid_vout)
	if (input.startsWith('/')) {
		const cleaned = input.slice(1)
		if (outpointRe.test(cleaned)) {
			return `${STACK_URL}/content/${cleaned}`
		}
	}

	return null
}

/** Determine confirm-button disabled state */
function isConfirmDisabled(
	activeTab: ImageSourceTab,
	urlInput: string,
	uploadPreview: string | null,
): boolean {
	if (activeTab === 'url') return !urlInput.trim()
	if (activeTab === 'upload') return !uploadPreview
	// Ordinals tab confirms inline (clicking an ordinal fires immediately)
	return true
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export function ImageSelectionModal({
	open,
	onOpenChange,
	onImageSelected,
	title,
	aspectRatio = 1,
}: ImageSelectionModalProps) {
	const [activeTab, setActiveTab] = useState<ImageSourceTab>('url')

	// URL tab state
	const [urlInput, setUrlInput] = useState('')
	const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null)
	const [previewLoading, setPreviewLoading] = useState(false)

	// Ordinals tab state
	const [ordinals, setOrdinals] = useState<OrdinalInfo[]>([])
	const [ordinalsLoading, setOrdinalsLoading] = useState(false)
	const [ordinalsError, setOrdinalsError] = useState<string | null>(null)

	// Upload tab state
	const [uploadPreview, setUploadPreview] = useState<string | null>(null)
	const [uploadFilename, setUploadFilename] = useState<string | null>(null)
	const [uploading, setUploading] = useState(false)

	const previewTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

	// ---------------------------------------------------------------------------
	// URL preview effect
	// ---------------------------------------------------------------------------

	useEffect(() => {
		if (previewTimeoutRef.current) {
			clearTimeout(previewTimeoutRef.current)
		}

		if (!urlInput.trim()) {
			setPreviewImageUrl(null)
			setPreviewLoading(false)
			return
		}

		setPreviewLoading(true)
		previewTimeoutRef.current = setTimeout(() => {
			const resolved = resolvePreviewUrl(urlInput)
			setPreviewImageUrl(resolved)
			if (!resolved) setPreviewLoading(false)
		}, 300)

		return () => {
			if (previewTimeoutRef.current) {
				clearTimeout(previewTimeoutRef.current)
			}
		}
	}, [urlInput])

	// ---------------------------------------------------------------------------
	// Load ordinals when the tab opens
	// ---------------------------------------------------------------------------

	useEffect(() => {
		if (!open || activeTab !== 'ordinals') return
		if (ordinals.length > 0 || ordinalsLoading) return

		setOrdinalsLoading(true)
		setOrdinalsError(null)

		rpc.request
			.getOrdinals({ limit: 100 })
			.then((result) => {
				setOrdinals(result.ordinals)
			})
			.catch((err) => {
				setOrdinalsError(
					err instanceof Error ? err.message : 'Failed to load ordinals',
				)
			})
			.finally(() => {
				setOrdinalsLoading(false)
			})
	}, [open, activeTab, ordinals.length, ordinalsLoading])

	// ---------------------------------------------------------------------------
	// Handlers
	// ---------------------------------------------------------------------------

	const handleClose = useCallback(() => {
		setActiveTab('url')
		setUrlInput('')
		setPreviewImageUrl(null)
		setPreviewLoading(false)
		setOrdinals([])
		setOrdinalsError(null)
		setUploadPreview(null)
		setUploadFilename(null)
		onOpenChange(false)
	}, [onOpenChange])

	const handleOrdinalSelect = useCallback(
		(outpoint: string) => {
			// Return the ORDFS URL for the selected ordinal
			onImageSelected(`${STACK_URL}/content/${outpoint}`)
			handleClose()
		},
		[onImageSelected, handleClose],
	)

	const handlePickFile = useCallback(async () => {
		setUploading(true)
		try {
			const res = await rpc.request.pickFile({
				allowedFileTypes: 'png,jpg,jpeg,gif,webp,svg',
			})
			if ('error' in res) {
				// User cancelled -- silently ignore
				return
			}
			const dataUrl = `data:${res.contentType};base64,${res.base64Content}`
			setUploadPreview(dataUrl)
			setUploadFilename(res.filename)
		} finally {
			setUploading(false)
		}
	}, [])

	const handleClearUpload = useCallback(() => {
		setUploadPreview(null)
		setUploadFilename(null)
	}, [])

	const handleConfirm = useCallback(() => {
		if (activeTab === 'url') {
			const resolved = resolvePreviewUrl(urlInput)
			if (resolved) {
				onImageSelected(resolved)
				handleClose()
			}
		} else if (activeTab === 'upload' && uploadPreview) {
			onImageSelected(uploadPreview)
			handleClose()
		}
	}, [activeTab, urlInput, uploadPreview, onImageSelected, handleClose])

	// ---------------------------------------------------------------------------
	// Render
	// ---------------------------------------------------------------------------

	const dialogTitle =
		title ?? (aspectRatio >= 2 ? 'Select Banner Image' : 'Select Image')

	return (
		<Dialog open={open} onOpenChange={(v) => (v ? undefined : handleClose())}>
			<DialogContent className="flex max-h-[85vh] max-w-2xl flex-col p-6">
				<DialogHeader>
					<DialogTitle>{dialogTitle}</DialogTitle>
				</DialogHeader>

				<Tabs
					className="flex flex-1 flex-col overflow-hidden"
					onValueChange={(v) => setActiveTab(v as ImageSourceTab)}
					value={activeTab}
				>
					<TabsList className="grid w-full grid-cols-3">
						<TabsTrigger value="url">
							<Link className="mr-1.5 size-3.5" />
							URL
						</TabsTrigger>
						<TabsTrigger value="ordinals">
							<Gem className="mr-1.5 size-3.5" />
							Ordinals
						</TabsTrigger>
						<TabsTrigger value="upload">
							<Upload className="mr-1.5 size-3.5" />
							Upload
						</TabsTrigger>
					</TabsList>

					{/* URL Tab */}
					<UrlTabContent
						urlInput={urlInput}
						onUrlChange={setUrlInput}
						previewLoading={previewLoading}
						previewImageUrl={previewImageUrl}
						aspectRatio={aspectRatio}
					/>

					{/* Ordinals Tab */}
					<OrdinalsTabContent
						ordinals={ordinals}
						loading={ordinalsLoading}
						error={ordinalsError}
						aspectRatio={aspectRatio}
						onSelect={handleOrdinalSelect}
					/>

					{/* Upload Tab */}
					<UploadTabContent
						uploadPreview={uploadPreview}
						uploadFilename={uploadFilename}
						uploading={uploading}
						aspectRatio={aspectRatio}
						onPickFile={handlePickFile}
						onClear={handleClearUpload}
					/>
				</Tabs>

				<DialogFooter className="mt-4">
					<Button onClick={handleClose} variant="outline">
						Cancel
					</Button>
					<Button
						disabled={isConfirmDisabled(activeTab, urlInput, uploadPreview)}
						onClick={handleConfirm}
					>
						Confirm
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	)
}
