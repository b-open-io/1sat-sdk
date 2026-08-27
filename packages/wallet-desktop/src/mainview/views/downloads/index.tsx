import { Download as DownloadIcon } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Empty } from '@/components/ui/empty'
import { cn } from '../../lib/utils'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Download {
	id: string
	filename: string
	url: string
	size: number // bytes
	downloaded: number // bytes downloaded so far
	status: 'downloading' | 'complete' | 'failed' | 'cancelled'
	startedAt: string // ISO date
	completedAt?: string
}

interface DownloadsViewProps {
	onNavigate?: (url: string) => void
}

// ---------------------------------------------------------------------------
// Shared store — external callers (e.g. the browser) import this to push
// download events into the view without prop-drilling.
// ---------------------------------------------------------------------------

type DownloadListener = (downloads: Download[]) => void

let _downloads: Download[] = []
const _listeners = new Set<DownloadListener>()

function notify() {
	for (const fn of _listeners) fn([..._downloads])
}

/** Add or update a download. Call this from the browser when a download starts,
 *  progresses, or finishes. */
export function upsertDownload(next: Download): void {
	const idx = _downloads.findIndex((d) => d.id === next.id)
	if (idx === -1) {
		_downloads = [next, ..._downloads]
	} else {
		_downloads = _downloads.map((d) => (d.id === next.id ? next : d))
	}
	notify()
}

/** Convenience alias kept for backwards compatibility. */
export const addDownload = upsertDownload

function removeDownload(id: string): void {
	_downloads = _downloads.filter((d) => d.id !== id)
	notify()
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatBytes(bytes: number): string {
	if (bytes === 0) return '—'
	if (bytes < 1024) return `${bytes} B`
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
	if (bytes < 1024 * 1024 * 1024)
		return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
	return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

function formatDate(iso: string): string {
	const d = new Date(iso)
	return d.toLocaleDateString('en-US', {
		month: 'short',
		day: 'numeric',
		year: 'numeric',
	})
}

function truncateUrl(url: string, max = 40): string {
	try {
		const u = new URL(url)
		const display = u.hostname + u.pathname
		if (display.length <= max) return display
		return `${display.slice(0, max)}…`
	} catch {
		return url.length > max ? `${url.slice(0, max)}…` : url
	}
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

interface StatusDotProps {
	status: Download['status']
}

function StatusDot({ status }: StatusDotProps) {
	if (status === 'complete') {
		return (
			<span
				className="inline-block rounded-full shrink-0"
				style={{ width: 8, height: 8, backgroundColor: '#22c55e' }}
			/>
		)
	}
	if (status === 'downloading') {
		return (
			<span
				className="inline-block rounded-full shrink-0 animate-pulse"
				style={{ width: 8, height: 8, backgroundColor: '#3b82f6' }}
			/>
		)
	}
	if (status === 'failed') {
		return (
			<span
				className="inline-block rounded-full shrink-0"
				style={{ width: 8, height: 8, backgroundColor: 'var(--destructive)' }}
			/>
		)
	}
	// cancelled
	return (
		<span
			className="inline-block rounded-full shrink-0"
			style={{
				width: 8,
				height: 8,
				backgroundColor: 'var(--muted-foreground)',
			}}
		/>
	)
}

interface ProgressCellProps {
	download: Download
}

function ProgressCell({ download }: ProgressCellProps) {
	if (download.status === 'complete') {
		return (
			<span
				className="font-[family-name:var(--font-sans)] text-muted-foreground"
				style={{ fontSize: 11 }}
			>
				Complete
			</span>
		)
	}
	if (download.status === 'cancelled') {
		return (
			<span
				className="font-[family-name:var(--font-sans)] text-muted-foreground"
				style={{ fontSize: 11 }}
			>
				Cancelled
			</span>
		)
	}
	if (download.status === 'failed') {
		return (
			<span
				className="font-[family-name:var(--font-sans)]"
				style={{ fontSize: 11, color: 'var(--destructive)' }}
			>
				Failed
			</span>
		)
	}

	// downloading — render a progress bar
	const pct =
		download.size > 0
			? Math.round((download.downloaded / download.size) * 100)
			: 0

	return (
		<div className="flex flex-col gap-1 w-full" style={{ minWidth: 0 }}>
			<div
				className="relative w-full bg-muted overflow-hidden"
				style={{ height: 4 }}
			>
				<div
					className="absolute inset-y-0 left-0 transition-all"
					style={{ width: `${pct}%`, backgroundColor: '#3b82f6' }}
				/>
			</div>
			<span
				className="font-[family-name:var(--font-mono)] text-muted-foreground"
				style={{ fontSize: 10 }}
			>
				{pct}%
			</span>
		</div>
	)
}

interface RowActionsProps {
	download: Download
	onCancel: (id: string) => void
	onRetry: (id: string) => void
	onRemove: (id: string) => void
	onOpen: (id: string) => void
	onReveal: (id: string) => void
}

function RowActions({
	download,
	onCancel,
	onRetry,
	onRemove,
	onOpen,
	onReveal,
}: RowActionsProps) {
	const actionBtn = (
		label: string,
		handler: () => void,
		variant: 'default' | 'destructive' = 'default',
	) => (
		<button
			type="button"
			onClick={(e) => {
				e.stopPropagation()
				handler()
			}}
			className={cn(
				'font-[family-name:var(--font-sans)] px-2 transition-colors bg-transparent border-none cursor-pointer',
				variant === 'destructive'
					? 'text-destructive hover:text-destructive/80'
					: 'text-muted-foreground hover:text-foreground',
			)}
			style={{ fontSize: 11, padding: '0 6px', height: 20, lineHeight: '20px' }}
		>
			{label}
		</button>
	)

	return (
		<div className="flex items-center" style={{ gap: 2 }}>
			{download.status === 'complete' && (
				<>
					{actionBtn('Open', () => onOpen(download.id))}
					{actionBtn('Reveal', () => onReveal(download.id))}
				</>
			)}
			{download.status === 'downloading' &&
				actionBtn('Cancel', () => onCancel(download.id), 'destructive')}
			{download.status === 'failed' &&
				actionBtn('Retry', () => onRetry(download.id))}
			{download.status !== 'downloading' &&
				actionBtn('Remove', () => onRemove(download.id), 'destructive')}
		</div>
	)
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function DownloadsView({ onNavigate: _onNavigate }: DownloadsViewProps) {
	const [downloads, setDownloads] = useState<Download[]>([..._downloads])

	const scrollRef = useRef<HTMLDivElement>(null)

	// Subscribe to the shared store on mount, unsubscribe on unmount
	useEffect(() => {
		const listener: DownloadListener = (next) => setDownloads(next)
		_listeners.add(listener)
		// Sync immediately in case the store was updated before mount
		setDownloads([..._downloads])
		return () => {
			_listeners.delete(listener)
		}
	}, [])

	// ---------------------------------------------------------------------------
	// Row action handlers (stubs — wire to OS APIs when available)
	// ---------------------------------------------------------------------------

	function handleCancel(id: string) {
		const d = downloads.find((x) => x.id === id)
		if (!d) return
		upsertDownload({ ...d, status: 'cancelled' })
	}

	function handleRetry(id: string) {
		const d = downloads.find((x) => x.id === id)
		if (!d) return
		upsertDownload({
			...d,
			status: 'downloading',
			downloaded: 0,
			completedAt: undefined,
			startedAt: new Date().toISOString(),
		})
	}

	function handleRemove(id: string) {
		removeDownload(id)
	}

	function handleOpen(_id: string) {
		// TODO: wire to Wails runtime openFile once path is tracked
	}

	function handleReveal(_id: string) {
		// TODO: wire to Wails runtime revealInFinder once path is tracked
	}

	return (
		<div className="flex h-full w-full flex-col overflow-hidden">
			<div
				ref={scrollRef}
				className="flex-1 overflow-y-auto"
				style={{ padding: 24 }}
			>
				{/* Title row */}
				<div
					className="flex items-center justify-between"
					style={{ marginBottom: 20 }}
				>
					<h1
						className="font-[family-name:var(--font-sans)] text-foreground"
						style={{ fontSize: 20, fontWeight: 700, lineHeight: 1 }}
					>
						Downloads
					</h1>

					{downloads.length > 0 && (
						<button
							type="button"
							onClick={() => {
								_downloads = _downloads.filter(
									(d) => d.status === 'downloading',
								)
								notify()
							}}
							className="font-[family-name:var(--font-sans)] text-muted-foreground hover:text-foreground bg-transparent border-none cursor-pointer transition-colors"
							style={{ fontSize: 11 }}
						>
							Clear completed
						</button>
					)}
				</div>

				{/* Table */}
				<div className="w-full border border-border">
					{/* Table header */}
					<div
						className="flex items-center bg-card border-b border-border"
						style={{ height: 36, paddingLeft: 16, paddingRight: 16 }}
					>
						{/* Status icon col */}
						<div className="shrink-0" style={{ width: 24 }} />
						{/* Filename col */}
						<div
							className="flex-1 min-w-0 text-muted-foreground font-[family-name:var(--font-sans)]"
							style={{ fontSize: 11, fontWeight: 600 }}
						>
							File
						</div>
						{/* Size col */}
						<div
							className="shrink-0 text-right text-muted-foreground font-[family-name:var(--font-sans)]"
							style={{ width: 100, fontSize: 11, fontWeight: 600 }}
						>
							Size
						</div>
						{/* Progress col */}
						<div
							className="shrink-0 text-muted-foreground font-[family-name:var(--font-sans)]"
							style={{
								width: 120,
								fontSize: 11,
								fontWeight: 600,
								paddingLeft: 12,
							}}
						>
							Progress
						</div>
						{/* Date col */}
						<div
							className="shrink-0 text-right text-muted-foreground font-[family-name:var(--font-sans)]"
							style={{ width: 120, fontSize: 11, fontWeight: 600 }}
						>
							Date
						</div>
					</div>

					{/* Table body */}
					{downloads.length === 0 ? (
						<Empty
							icon={DownloadIcon}
							title="No downloads yet"
							description="Files downloaded from the browser appear here."
						/>
					) : (
						downloads.map((dl) => (
							<div
								key={dl.id}
								className="group flex w-full items-center border-b border-border bg-background transition-colors hover:bg-card"
								style={{ minHeight: 48, paddingLeft: 16, paddingRight: 16 }}
							>
								{/* Status dot */}
								<div
									className="shrink-0 flex items-center"
									style={{ width: 24 }}
								>
									<StatusDot status={dl.status} />
								</div>

								{/* Filename + URL subtitle + row actions */}
								<div className="flex-1 min-w-0 flex flex-col justify-center py-2">
									<div className="flex items-center gap-3">
										<p
											className="truncate font-[family-name:var(--font-sans)] text-foreground leading-tight"
											style={{ fontSize: 13, fontWeight: 500 }}
										>
											{dl.filename}
										</p>
										{/* Actions revealed on hover */}
										<div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center shrink-0">
											<RowActions
												download={dl}
												onCancel={handleCancel}
												onRetry={handleRetry}
												onRemove={handleRemove}
												onOpen={handleOpen}
												onReveal={handleReveal}
											/>
										</div>
									</div>
									<p
										className="font-[family-name:var(--font-mono)] text-muted-foreground leading-tight truncate"
										style={{ fontSize: 10, fontWeight: 400 }}
									>
										{truncateUrl(dl.url)}
									</p>
								</div>

								{/* Size */}
								<div className="shrink-0 text-right" style={{ width: 100 }}>
									<span
										className="font-[family-name:var(--font-mono)] text-muted-foreground"
										style={{ fontSize: 11 }}
									>
										{dl.status === 'downloading' && dl.size > 0
											? `${formatBytes(dl.downloaded)} / ${formatBytes(dl.size)}`
											: formatBytes(dl.size)}
									</span>
								</div>

								{/* Progress */}
								<div
									className="shrink-0 flex items-center"
									style={{ width: 120, paddingLeft: 12 }}
								>
									<ProgressCell download={dl} />
								</div>

								{/* Date */}
								<div className="shrink-0 text-right" style={{ width: 120 }}>
									<span
										className="font-[family-name:var(--font-sans)] text-muted-foreground"
										style={{ fontSize: 11 }}
									>
										{formatDate(dl.completedAt ?? dl.startedAt)}
									</span>
								</div>
							</div>
						))
					)}
				</div>
			</div>
		</div>
	)
}
