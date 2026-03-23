import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
	ArrowLeft,
	Copy,
	ExternalLink,
	FileQuestion,
	ImageOff,
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ORDFS_BASE = 'http://127.0.0.1:8080'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface MapAttributes {
	[key: string]: string | undefined
}

interface OrdinalMetadata {
	contentType: string | undefined
	fileSize: number | undefined
	map: MapAttributes
	name: string | undefined
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Parse the raw metadata response from the ORDFS metadata endpoint.
 * The response shape is not strictly typed — extract what we can defensively.
 */
function parseMetadata(raw: unknown): OrdinalMetadata {
	if (typeof raw !== 'object' || raw === null) {
		return {
			contentType: undefined,
			fileSize: undefined,
			map: {},
			name: undefined,
		}
	}

	const r = raw as Record<string, unknown>

	// MAP attributes live in the `map` key; values are typically strings
	const mapRaw =
		typeof r.map === 'object' && r.map !== null
			? (r.map as Record<string, unknown>)
			: {}
	const map: MapAttributes = {}
	for (const [k, v] of Object.entries(mapRaw)) {
		if (typeof v === 'string') map[k] = v
		else if (v !== null && v !== undefined) map[k] = String(v)
	}

	const contentType =
		typeof r.contentType === 'string' ? r.contentType : undefined
	const fileSize = typeof r.size === 'number' ? r.size : undefined
	const name = map.name ?? (typeof r.name === 'string' ? r.name : undefined)

	return { contentType, fileSize, map, name }
}

function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
	return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

/** Truncate a long outpoint string for display, keeping both ends readable. */
function truncateOutpoint(outpoint: string, visibleChars = 10): string {
	if (outpoint.length <= visibleChars * 2 + 3) return outpoint
	return `${outpoint.slice(0, visibleChars)}…${outpoint.slice(-visibleChars)}`
}

/** Extract the txid from an outpoint string (`txid_vout`). */
function txidFromOutpoint(outpoint: string): string {
	const idx = outpoint.lastIndexOf('_')
	return idx === -1 ? outpoint : outpoint.slice(0, idx)
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

interface ContentPreviewProps {
	outpoint: string
}

function ContentPreview({ outpoint }: ContentPreviewProps) {
	const [imgError, setImgError] = useState(false)
	const contentUrl = `${ORDFS_BASE}/content/${outpoint}`

	return (
		<div className="relative flex h-full w-full items-center justify-center bg-muted overflow-hidden">
			{imgError ? (
				<div className="flex flex-col items-center justify-center gap-3 text-muted-foreground">
					<ImageOff size={48} strokeWidth={1.5} />
					<span className="text-xs">Preview unavailable</span>
				</div>
			) : (
				<img
					src={contentUrl}
					alt={`Ordinal ${outpoint}`}
					className="max-h-full max-w-full object-contain"
					onError={() => setImgError(true)}
				/>
			)}
		</div>
	)
}

// ---------------------------------------------------------------------------
// MetaRow — single key/value pair in the attributes grid
// ---------------------------------------------------------------------------

interface MetaRowProps {
	label: string
	value: string
}

function MetaRow({ label, value }: MetaRowProps) {
	return (
		<>
			<dt
				className="text-[10px] uppercase tracking-wider text-muted-foreground truncate"
				title={label}
			>
				{label}
			</dt>
			<dd
				className="text-[11px] font-medium text-foreground break-all"
				title={value}
			>
				{value}
			</dd>
		</>
	)
}

// ---------------------------------------------------------------------------
// MetadataPanel
// ---------------------------------------------------------------------------

interface MetadataPanelProps {
	outpoint: string
	onNavigate?: (url: string) => void
}

function MetadataPanel({ outpoint, onNavigate }: MetadataPanelProps) {
	const [metadata, setMetadata] = useState<OrdinalMetadata | null>(null)
	const [loading, setLoading] = useState(true)
	const [fetchError, setFetchError] = useState<string | null>(null)
	const [copied, setCopied] = useState(false)

	useEffect(() => {
		let cancelled = false
		setLoading(true)
		setFetchError(null)
		setMetadata(null)

		fetch(`${ORDFS_BASE}/1sat/ordfs/metadata/${outpoint}`)
			.then((res) => {
				if (!res.ok) {
					throw new Error(
						`Metadata request failed: ${res.status} ${res.statusText}`,
					)
				}
				return res.json()
			})
			.then((raw: unknown) => {
				if (!cancelled) setMetadata(parseMetadata(raw))
			})
			.catch((err: unknown) => {
				if (!cancelled) {
					setFetchError(
						err instanceof Error ? err.message : 'Failed to load metadata',
					)
				}
			})
			.finally(() => {
				if (!cancelled) setLoading(false)
			})

		return () => {
			cancelled = true
		}
	}, [outpoint])

	const handleCopy = useCallback(() => {
		navigator.clipboard.writeText(outpoint).then(() => {
			setCopied(true)
			setTimeout(() => setCopied(false), 1500)
		})
	}, [outpoint])

	const handleViewOnExplorer = useCallback(() => {
		const txid = txidFromOutpoint(outpoint)
		const url = `https://whatsonchain.com/tx/${txid}`
		if (onNavigate) {
			onNavigate(url)
		} else {
			window.open(url, '_blank', 'noopener,noreferrer')
		}
	}, [outpoint, onNavigate])

	const displayName = metadata?.name ?? (loading ? 'Loading…' : 'Unnamed')

	// Collect MAP attributes that are not the name (name already shown in header)
	const mapEntries = metadata
		? Object.entries(metadata.map).filter(([k]) => k !== 'name')
		: []

	return (
		<div className="flex h-full flex-col overflow-y-auto p-4 gap-4">
			{/* Inscription header */}
			<div className="flex flex-col gap-1">
				<h2 className="text-sm font-semibold text-foreground leading-tight">
					{loading ? (
						<Skeleton className="h-4 w-32 rounded-none" />
					) : (
						displayName
					)}
				</h2>
				<span
					className="text-[10px] text-muted-foreground break-all leading-tight"
					style={{ fontFamily: 'var(--font-mono)' }}
					title={outpoint}
				>
					{truncateOutpoint(outpoint)}
				</span>
			</div>

			{/* File info */}
			{(loading ||
				metadata?.contentType ||
				metadata?.fileSize !== undefined) && (
				<div className="flex flex-col gap-1.5 border-t border-border pt-3">
					<span className="text-[10px] uppercase tracking-wider text-muted-foreground">
						File Info
					</span>
					{loading ? (
						<div className="flex flex-col gap-1">
							<Skeleton className="h-3 w-40 rounded-none" />
							<Skeleton className="h-3 w-24 rounded-none" />
						</div>
					) : (
						<dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
							{metadata?.contentType && (
								<MetaRow label="Type" value={metadata.contentType} />
							)}
							{metadata?.fileSize !== undefined && (
								<MetaRow label="Size" value={formatBytes(metadata.fileSize)} />
							)}
						</dl>
					)}
				</div>
			)}

			{/* MAP attributes */}
			<div className="flex flex-col gap-1.5 border-t border-border pt-3">
				<span className="text-[10px] uppercase tracking-wider text-muted-foreground">
					Attributes
				</span>

				{loading && (
					<div className="flex flex-col gap-1.5">
						{[48, 64, 40, 56].map((w) => (
							<Skeleton
								key={w}
								className="h-3 rounded-none"
								style={{ width: w }}
							/>
						))}
					</div>
				)}

				{!loading && fetchError && (
					<p className="text-[11px] text-destructive">{fetchError}</p>
				)}

				{!loading && !fetchError && mapEntries.length === 0 && (
					<p className="text-[11px] text-muted-foreground">No attributes</p>
				)}

				{!loading && !fetchError && mapEntries.length > 0 && (
					<dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
						{mapEntries.map(([key, value]) =>
							value !== undefined ? (
								<MetaRow key={key} label={key} value={value} />
							) : null,
						)}
					</dl>
				)}
			</div>

			{/* Spacer pushes actions to the bottom when content is short */}
			<div className="flex-1" />

			{/* Action buttons */}
			<div className="flex flex-col gap-2 border-t border-border pt-3">
				<Button
					variant="outline"
					size="sm"
					className="w-full justify-start gap-2 text-xs"
					onClick={handleViewOnExplorer}
				>
					<ExternalLink aria-hidden="true" />
					View on Explorer
				</Button>
				<Button
					variant="outline"
					size="sm"
					className="w-full justify-start gap-2 text-xs"
					onClick={handleCopy}
				>
					<Copy aria-hidden="true" />
					{copied ? 'Copied!' : 'Copy Outpoint'}
				</Button>
			</div>
		</div>
	)
}

// ---------------------------------------------------------------------------
// OrdinalDetailView — exported root
// ---------------------------------------------------------------------------

export interface OrdinalDetailViewProps {
	params: Record<string, string>
	onNavigate?: (url: string) => void
}

export function OrdinalDetailView({
	params,
	onNavigate,
}: OrdinalDetailViewProps) {
	const outpoint = params.outpoint ?? ''

	const handleBack = useCallback(() => {
		onNavigate?.('1sat://ordinals/gallery')
	}, [onNavigate])

	if (!outpoint) {
		return (
			<div className="flex h-full w-full flex-col items-center justify-center gap-3 text-muted-foreground">
				<FileQuestion size={40} strokeWidth={1.5} />
				<span className="text-sm">No outpoint provided</span>
				<Button variant="ghost" size="sm" onClick={handleBack}>
					<ArrowLeft aria-hidden="true" />
					Back to Gallery
				</Button>
			</div>
		)
	}

	return (
		<div className="flex h-full w-full flex-col bg-background">
			{/* Top bar */}
			<div className="flex items-center gap-2 border-b border-border px-4 py-2 flex-shrink-0">
				<Button
					variant="ghost"
					size="icon-sm"
					onClick={handleBack}
					aria-label="Back to gallery"
				>
					<ArrowLeft aria-hidden="true" />
				</Button>
				<span
					className="text-xs text-muted-foreground truncate"
					style={{ fontFamily: 'var(--font-mono)' }}
					title={outpoint}
				>
					{truncateOutpoint(outpoint, 16)}
				</span>
			</div>

			{/* Split body */}
			<div className="flex flex-1 min-h-0">
				{/* Left: content preview — 55% */}
				<div className="w-[55%] flex-shrink-0 border-r border-border">
					<ContentPreview outpoint={outpoint} />
				</div>

				{/* Right: metadata panel — 45% */}
				<div className="w-[45%] flex-shrink-0 min-h-0">
					<MetadataPanel outpoint={outpoint} onNavigate={onNavigate} />
				</div>
			</div>
		</div>
	)
}
