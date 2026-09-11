import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
	AlertCircle,
	ArrowLeft,
	CheckCircle2,
	Copy,
	ExternalLink,
	FileQuestion,
	ImageOff,
	Loader2,
	ShoppingCart,
	Tag,
	XCircle,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { OrdinalInfo } from '../../../shared/types.js'
import { ORDFS_BASE } from '../../lib/url-parser'
import { rpc } from '../../rpc'
import { type OrdLockListing, ownedListing, parseListing } from './listing.js'

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

/** Fetch listing data for an outpoint from the local OrdLock index. */
function useListing(outpoint: string): {
	listing: OrdLockListing | null
	listingLoading: boolean
	refresh: () => void
	refreshKey: number
} {
	const [listing, setListing] = useState<OrdLockListing | null>(null)
	const [listingLoading, setListingLoading] = useState(true)
	const [refreshKey, setRefreshKey] = useState(0)

	const refresh = useCallback(() => {
		setRefreshKey((k) => k + 1)
	}, [])

	// biome-ignore lint/correctness/useExhaustiveDependencies: Refresh after a successful listing operation.
	useEffect(() => {
		if (!outpoint) {
			setListingLoading(false)
			return
		}

		let cancelled = false
		setListingLoading(true)
		setListing(null)

		fetch(`${ORDFS_BASE}/1sat/market/origin/${outpoint}`)
			.then((res) => {
				// 404 means not listed — not an error
				if (res.status === 404) return null
				if (!res.ok) throw new Error(`Listing fetch: ${res.status}`)
				return res.json()
			})
			.then((raw: unknown) => {
				if (!cancelled) setListing(parseListing(raw))
			})
			.catch(() => {
				// Listing fetch failure is non-fatal; treat as unlisted
				if (!cancelled) setListing(null)
			})
			.finally(() => {
				if (!cancelled) setListingLoading(false)
			})

		return () => {
			cancelled = true
		}
	}, [outpoint, refreshKey])

	return { listing, listingLoading, refresh, refreshKey }
}

/** Check whether the outpoint belongs to the current wallet's ordinals. */
function useIsOwned(
	outpoint: string,
	refreshKey: number,
): {
	owned: OrdinalInfo | null
	ownershipLoading: boolean
	ownershipError: string | null
} {
	const [owned, setOwned] = useState<OrdinalInfo | null>(null)
	const [ownershipLoading, setOwnershipLoading] = useState(true)
	const [ownershipError, setOwnershipError] = useState<string | null>(null)

	// biome-ignore lint/correctness/useExhaustiveDependencies: Refresh after a successful listing operation.
	useEffect(() => {
		if (!outpoint) {
			setOwnershipLoading(false)
			return
		}

		let cancelled = false
		setOwnershipLoading(true)
		setOwnershipError(null)
		setOwned(null)

		rpc.request
			.getOwnedOrdinal({ outpoint })
			.then((result) => {
				if (!cancelled) {
					setOwned(result.ordinal)
				}
			})
			.catch((error: unknown) => {
				if (!cancelled)
					setOwnershipError(
						error instanceof Error
							? error.message
							: 'Unable to load wallet inventory. Retry.',
					)
			})
			.finally(() => {
				if (!cancelled) setOwnershipLoading(false)
			})

		return () => {
			cancelled = true
		}
	}, [outpoint, refreshKey])

	return { owned, ownershipLoading, ownershipError }
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
	listing: OrdLockListing | null
	listingLoading: boolean
	isOwned: boolean
	ownershipLoading: boolean
	ownershipError: string | null
	onNavigate?: (url: string) => void
	onListingChanged?: () => void
}

function MetadataPanel({
	outpoint,
	listing,
	listingLoading,
	isOwned,
	ownershipLoading,
	ownershipError,
	onNavigate,
	onListingChanged,
}: MetadataPanelProps) {
	const [metadata, setMetadata] = useState<OrdinalMetadata | null>(null)
	const [loading, setLoading] = useState(true)
	const [fetchError, setFetchError] = useState<string | null>(null)
	const [copied, setCopied] = useState(false)
	const copyTimeoutRef = useRef<ReturnType<typeof setTimeout>>()

	// Marketplace action states
	const [actionLoading, setActionLoading] = useState(false)
	const [actionError, setActionError] = useState<string | null>(null)
	const [actionSuccess, setActionSuccess] = useState<string | null>(null)

	useEffect(() => () => clearTimeout(copyTimeoutRef.current), [])

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
		navigator.clipboard
			.writeText(outpoint)
			.then(() => {
				clearTimeout(copyTimeoutRef.current)
				setCopied(true)
				copyTimeoutRef.current = setTimeout(() => setCopied(false), 1500)
			})
			.catch(() => {})
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

	const clearActionState = useCallback(() => {
		setActionError(null)
		setActionSuccess(null)
	}, [])

	const handleBuy = useCallback(async () => {
		clearActionState()
		setActionLoading(true)
		try {
			const result = await rpc.request.purchaseOrdinal({
				outpoint: listing?.outpoint ?? outpoint,
			})
			if (result.error || !result.txid?.trim()) {
				setActionError(result.error || 'Transaction did not complete. Retry.')
			} else {
				setActionSuccess(`Purchased! txid: ${result.txid}`)
				onListingChanged?.()
			}
		} catch (err) {
			setActionError(err instanceof Error ? err.message : 'Purchase failed')
		} finally {
			setActionLoading(false)
		}
	}, [outpoint, listing, clearActionState, onListingChanged])

	const handleCancelListing = useCallback(async () => {
		clearActionState()
		setActionLoading(true)
		try {
			const result = await rpc.request.cancelListing({ outpoint })
			if (result.error || !result.txid?.trim()) {
				setActionError(result.error || 'Transaction did not complete. Retry.')
			} else {
				setActionSuccess(`Listing cancelled. txid: ${result.txid}`)
				onListingChanged?.()
			}
		} catch (err) {
			setActionError(err instanceof Error ? err.message : 'Cancel failed')
		} finally {
			setActionLoading(false)
		}
	}, [outpoint, clearActionState, onListingChanged])

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

			{/* Listing status */}
			{(listingLoading || listing) && (
				<div className="flex flex-col gap-1.5 border-t border-border pt-3">
					<span className="text-[10px] uppercase tracking-wider text-muted-foreground">
						Marketplace
					</span>
					{listingLoading ? (
						<Skeleton className="h-4 w-28 rounded-none" />
					) : listing ? (
						<div className="flex items-center gap-1.5">
							<Tag
								size={12}
								className="text-primary flex-shrink-0"
								aria-hidden="true"
							/>
							<span className="text-sm font-semibold text-primary">
								{listing.priceSats?.toLocaleString() ?? 'Unknown'} sats
							</span>
							<span className="text-[10px] text-muted-foreground">
								listed for sale
							</span>
						</div>
					) : null}
				</div>
			)}

			{/* Spacer pushes actions to the bottom when content is short */}
			<div className="flex-1" />

			{/* Action feedback */}
			{actionError && (
				<div className="flex items-start gap-2 border border-destructive/30 bg-destructive/5 p-3">
					<AlertCircle
						size={14}
						className="mt-0.5 shrink-0 text-destructive"
						aria-hidden="true"
					/>
					<p className="text-[11px] text-destructive">{actionError}</p>
				</div>
			)}
			{actionSuccess && (
				<div className="flex items-start gap-2 border border-primary/30 bg-primary/5 p-3">
					<CheckCircle2
						size={14}
						className="mt-0.5 shrink-0 text-primary"
						aria-hidden="true"
					/>
					<p className="text-[11px] text-primary">{actionSuccess}</p>
				</div>
			)}

			{/* Action buttons */}
			<div className="flex flex-col gap-2 border-t border-border pt-3">
				{/* Buy / Cancel / List for Sale — based on listing + ownership */}
				{ownershipError ? (
					<>
						<p className="text-xs text-destructive">{ownershipError}</p>
						<Button variant="outline" onClick={onListingChanged}>
							Retry Wallet Inventory
						</Button>
					</>
				) : listingLoading || ownershipLoading ? (
					<Skeleton className="h-7 w-full rounded-none" />
				) : listing && isOwned ? (
					<Button
						variant="outline"
						size="sm"
						className="w-full justify-start gap-2 text-xs"
						disabled={actionLoading}
						onClick={handleCancelListing}
					>
						{actionLoading ? (
							<Loader2 className="animate-spin" aria-hidden="true" />
						) : (
							<XCircle aria-hidden="true" />
						)}
						Cancel Listing
					</Button>
				) : listing ? (
					<Button
						variant="default"
						size="sm"
						className="w-full justify-start gap-2 text-xs"
						disabled={actionLoading || listing.priceSats === undefined}
						onClick={handleBuy}
					>
						{actionLoading ? (
							<Loader2 className="animate-spin" aria-hidden="true" />
						) : (
							<ShoppingCart aria-hidden="true" />
						)}
						Buy for {listing.priceSats?.toLocaleString() ?? 'Unknown'} sats
					</Button>
				) : isOwned ? (
					<p className="text-[11px] text-muted-foreground">
						OrdLock listing create is disabled. Existing listings can still be
						cancelled.
					</p>
				) : null}

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
	const {
		listing: marketListing,
		listingLoading,
		refresh: refreshListing,
		refreshKey,
	} = useListing(outpoint)
	const { owned, ownershipLoading, ownershipError } = useIsOwned(
		outpoint,
		refreshKey,
	)
	const isOwned = owned !== null
	const listing = owned ? ownedListing(owned) : marketListing

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
					<MetadataPanel
						outpoint={outpoint}
						listing={listing}
						listingLoading={isOwned ? false : listingLoading}
						isOwned={isOwned}
						ownershipLoading={ownershipLoading}
						ownershipError={ownershipError}
						onNavigate={onNavigate}
						onListingChanged={refreshListing}
					/>
				</div>
			</div>
		</div>
	)
}
