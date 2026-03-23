import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { rpc } from '../../rpc'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function truncate(value: string, head = 8, tail = 6): string {
	if (value.length <= head + tail + 3) return value
	return `${value.slice(0, head)}...${value.slice(-tail)}`
}

function getInitial(bapId: string): string {
	return bapId.slice(0, 1).toUpperCase()
}

// Deterministic hue from bapId string for avatar color
function getBapHue(bapId: string): number {
	let hash = 0
	for (let i = 0; i < bapId.length; i++) {
		hash = (hash * 31 + bapId.charCodeAt(i)) >>> 0
	}
	return hash % 360
}

// ─── Section header ───────────────────────────────────────────────────────────

function SectionHeader({ label }: { label: string }) {
	return (
		<div
			className="text-muted-foreground uppercase tracking-wider"
			style={{
				fontFamily: 'var(--font-mono)',
				fontSize: 10,
				letterSpacing: '0.1em',
			}}
		>
			{label}
		</div>
	)
}

// ─── Key-value row ────────────────────────────────────────────────────────────

function DetailRow({
	label,
	value,
	mono = false,
}: {
	label: string
	value: string
	mono?: boolean
}) {
	return (
		<div
			className="flex items-center justify-between py-3 border-b border-border"
			style={{ minHeight: 44 }}
		>
			<span
				className="text-muted-foreground shrink-0 mr-4"
				style={{ fontFamily: 'var(--font-sans)', fontSize: 12 }}
			>
				{label}
			</span>
			<span
				className="text-foreground text-right break-all"
				style={{
					fontFamily: mono ? 'var(--font-mono)' : 'var(--font-sans)',
					fontSize: 12,
				}}
			>
				{value}
			</span>
		</div>
	)
}

// ─── Avatar ───────────────────────────────────────────────────────────────────

function BapAvatar({ bapId, size = 64 }: { bapId: string; size?: number }) {
	const hue = getBapHue(bapId)
	return (
		<div
			className="flex items-center justify-center shrink-0 text-white font-semibold select-none"
			style={{
				width: size,
				height: size,
				borderRadius: '50%',
				background: `oklch(0.55 0.18 ${hue})`,
				fontFamily: 'var(--font-sans)',
				fontSize: size * 0.38,
			}}
			aria-hidden="true"
		>
			{getInitial(bapId)}
		</div>
	)
}

// ─── IdentityView ─────────────────────────────────────────────────────────────

export function IdentityView() {
	const [bapId, setBapId] = useState<string | null>(null)
	const [loading, setLoading] = useState(true)
	const [publishing, setPublishing] = useState(false)
	const [error, setError] = useState<string | null>(null)

	const fetchIdentity = useCallback(async () => {
		try {
			const result = await rpc.request.getIdentity()
			setBapId(result.bapId)
			setError(null)
		} catch (err) {
			setError(
				err instanceof Error ? err.message : 'Failed to load identity',
			)
		} finally {
			setLoading(false)
		}
	}, [])

	useEffect(() => {
		fetchIdentity()
	}, [fetchIdentity])

	const handlePublish = useCallback(async () => {
		setPublishing(true)
		setError(null)
		try {
			const result = await rpc.request.publishIdentity()
			if (result.error) {
				setError(result.error)
			} else if (result.bapId) {
				setBapId(result.bapId)
			}
		} catch (err) {
			setError(
				err instanceof Error ? err.message : 'Failed to publish identity',
			)
		} finally {
			setPublishing(false)
		}
	}, [])

	return (
		<div
			className="mx-auto w-full py-8 px-6"
			style={{ maxWidth: 800 }}
		>
			{/* Page title */}
			<h1
				className="text-foreground font-semibold mb-6"
				style={{
					fontFamily: 'var(--font-sans)',
					fontSize: 20,
					lineHeight: 1,
				}}
			>
				Identity
			</h1>

			{/* Error banner */}
			{error && (
				<div
					className="border border-destructive text-destructive mb-6 px-3 py-2"
					style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}
				>
					{error}
				</div>
			)}

			{loading ? (
				<p
					className="text-muted-foreground"
					style={{ fontFamily: 'var(--font-sans)', fontSize: 12 }}
				>
					Loading identity...
				</p>
			) : !bapId ? (
				/* ── Empty state ─────────────────────────────────────────────── */
				<div className="flex flex-col items-center justify-center py-16 gap-4 text-center">
					<p
						className="text-muted-foreground"
						style={{ fontFamily: 'var(--font-sans)', fontSize: 13 }}
					>
						No BAP identity published yet. Publish your identity to use social
						features and identity binding.
					</p>
					<Button onClick={handlePublish} disabled={publishing}>
						{publishing ? 'Publishing...' : 'Publish Identity'}
					</Button>
				</div>
			) : (
				/* ── Identity card ───────────────────────────────────────────── */
				<div>
					{/* Profile header */}
					<div className="flex items-center gap-4 mb-6">
						<BapAvatar bapId={bapId} size={64} />
						<div className="flex flex-col gap-1 min-w-0">
							<span
								className="text-foreground font-semibold"
								style={{ fontFamily: 'var(--font-sans)', fontSize: 14 }}
							>
								{truncate(bapId, 10, 8)}
							</span>
							<span
								className="text-muted-foreground"
								style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}
							>
								BAP Identity
							</span>
						</div>
					</div>

					{/* Divider */}
					<div className="border-t border-border mb-4" />

					{/* Details section */}
					<div className="mb-4">
						<SectionHeader label="Details" />
					</div>

					<div className="border-t border-border">
						<DetailRow label="BAP ID" value={truncate(bapId, 10, 8)} mono />
						<DetailRow label="Status" value="Published" />
					</div>

					{/* Publish button (shown when identity exists but could re-publish) */}
					<div className="mt-6">
						<Button
							variant="outline"
							onClick={handlePublish}
							disabled={publishing}
						>
							{publishing ? 'Publishing...' : 'Publish Identity'}
						</Button>
					</div>
				</div>
			)}
		</div>
	)
}
