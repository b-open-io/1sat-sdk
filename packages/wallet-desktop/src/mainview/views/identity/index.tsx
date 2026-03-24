import { useCallback, useEffect, useState } from 'react'
import { MessageCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { FollowButton } from '../../components/blocks/follow-button'
import type { FollowResult } from '../../components/blocks/follow-button'
import { rpc } from '../../rpc'
import type { BapProfile } from '../../components/blocks/profile-card/use-profile-card'

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

function parseProfile(raw: Record<string, unknown>): BapProfile {
	return {
		name: typeof raw.name === 'string' ? raw.name : undefined,
		alternateName:
			typeof raw.alternateName === 'string' ? raw.alternateName : undefined,
		givenName: typeof raw.givenName === 'string' ? raw.givenName : undefined,
		familyName: typeof raw.familyName === 'string' ? raw.familyName : undefined,
		description:
			typeof raw.description === 'string' ? raw.description : undefined,
		image: typeof raw.image === 'string' ? raw.image : undefined,
		url: typeof raw.url === 'string' ? raw.url : undefined,
	}
}

function buildDisplayName(profile: BapProfile): string | undefined {
	if (profile.name) return profile.name
	if (profile.givenName || profile.familyName) {
		return [profile.givenName, profile.familyName].filter(Boolean).join(' ')
	}
	return undefined
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

function BapAvatar({
	bapId,
	imageUrl,
	size = 64,
}: {
	bapId: string
	imageUrl?: string
	size?: number
}) {
	const hue = getBapHue(bapId)
	if (imageUrl) {
		return (
			<img
				src={imageUrl}
				alt="Profile avatar"
				className="shrink-0 object-cover"
				style={{
					width: size,
					height: size,
					borderRadius: '50%',
				}}
			/>
		)
	}
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

// ─── OtherProfileView ─────────────────────────────────────────────────────────

interface OtherProfileViewProps {
	targetBapId: string
	onNavigate?: (url: string) => void
}

function OtherProfileView({ targetBapId, onNavigate }: OtherProfileViewProps) {
	const [profile, setProfile] = useState<BapProfile | null>(null)
	const [loading, setLoading] = useState(true)
	const [error, setError] = useState<string | null>(null)
	const [followError, setFollowError] = useState<string | null>(null)

	useEffect(() => {
		let cancelled = false
		setLoading(true)
		setError(null)

		async function fetchProfile() {
			try {
				const res = await fetch(
					`http://127.0.0.1:8080/1sat/bap/profile/${encodeURIComponent(targetBapId)}`,
				)
				if (!res.ok) {
					throw new Error(`Profile fetch failed: ${res.status}`)
				}
				const raw: Record<string, unknown> = await res.json()
				if (cancelled) return
				const parsed = parseProfile(raw)
				if (!parsed.name) {
					parsed.name = buildDisplayName(parsed)
				}
				setProfile(parsed)
			} catch (err) {
				if (!cancelled) {
					setError(
						err instanceof Error ? err.message : 'Failed to load profile',
					)
				}
			} finally {
				if (!cancelled) {
					setLoading(false)
				}
			}
		}

		void fetchProfile()
		return () => {
			cancelled = true
		}
	}, [targetBapId])

	const handleMessage = useCallback(() => {
		onNavigate?.(`1sat://dm?bapId=${encodeURIComponent(targetBapId)}`)
	}, [targetBapId, onNavigate])

	const handleFollow = useCallback(async (bapId: string): Promise<FollowResult> => {
		setFollowError(null)
		const result = await rpc.request.createSocialPost({ content: `follow:${bapId}` })
		if (result.error) {
			return { error: result.error }
		}
		return { txid: result.txid }
	}, [])

	const displayName =
		profile?.name ?? profile?.alternateName ?? truncate(targetBapId, 10, 8)

	return (
		<div className="mx-auto w-full py-8 px-6" style={{ maxWidth: 800 }}>
			{/* Page title */}
			<h1
				className="text-foreground font-semibold mb-6"
				style={{
					fontFamily: 'var(--font-sans)',
					fontSize: 20,
					lineHeight: 1,
				}}
			>
				Profile
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
					Loading profile...
				</p>
			) : (
				<div>
					{/* Profile header */}
					<div className="flex items-center justify-between gap-4 mb-6">
						<div className="flex items-center gap-4 min-w-0">
							<BapAvatar
								bapId={targetBapId}
								imageUrl={profile?.image}
								size={64}
							/>
							<div className="flex flex-col gap-1 min-w-0">
								<span
									className="text-foreground font-semibold"
									style={{ fontFamily: 'var(--font-sans)', fontSize: 14 }}
								>
									{displayName}
								</span>
								{profile?.alternateName && profile.alternateName !== displayName && (
									<span
										className="text-muted-foreground"
										style={{ fontFamily: 'var(--font-sans)', fontSize: 12 }}
									>
										{profile.alternateName}
									</span>
								)}
								<span
									className="text-muted-foreground"
									style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}
								>
									BAP Identity
								</span>
							</div>
						</div>

						{/* Message button */}
						<Button
							variant="outline"
							size="sm"
							onClick={handleMessage}
							className="shrink-0 flex items-center gap-2"
						>
							<MessageCircle size={14} />
							Message
						</Button>
					</div>

					{/* Divider */}
					<div className="border-t border-border mb-4" />

					{/* Details section */}
					{profile?.description && (
						<div className="mb-4">
							<SectionHeader label="About" />
							<p
								className="text-foreground mt-2"
								style={{ fontFamily: 'var(--font-sans)', fontSize: 13, lineHeight: 1.5 }}
							>
								{profile.description}
							</p>
						</div>
					)}

					<div className="mb-4 mt-4">
						<SectionHeader label="Details" />
					</div>

					<div className="border-t border-border">
						<DetailRow label="BAP ID" value={truncate(targetBapId, 10, 8)} mono />
						{profile?.url && (
							<DetailRow label="Website" value={profile.url} />
						)}
					</div>
				</div>
			)}
		</div>
	)
}

// ─── IdentityView ─────────────────────────────────────────────────────────────

interface IdentityViewProps {
	params?: Record<string, string>
	onNavigate?: (url: string) => void
}

export function IdentityView({ params, onNavigate }: IdentityViewProps = {}) {
	const [ownBapId, setOwnBapId] = useState<string | null>(null)
	const [loading, setLoading] = useState(true)
	const [publishing, setPublishing] = useState(false)
	const [error, setError] = useState<string | null>(null)

	const fetchIdentity = useCallback(async () => {
		try {
			const result = await rpc.request.getIdentity()
			setOwnBapId(result.bapId)
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

	// If a bapId param is given and it's different from our own, show the other user's profile
	const targetBapId = params?.bapId
	const isViewingOther =
		!loading && targetBapId !== undefined && targetBapId !== ownBapId

	if (loading) {
		return (
			<div className="mx-auto w-full py-8 px-6" style={{ maxWidth: 800 }}>
				<p
					className="text-muted-foreground"
					style={{ fontFamily: 'var(--font-sans)', fontSize: 12 }}
				>
					Loading identity...
				</p>
			</div>
		)
	}

	if (isViewingOther && targetBapId) {
		return (
			<OtherProfileView targetBapId={targetBapId} onNavigate={onNavigate} />
		)
	}

	// ── Own identity view ─────────────────────────────────────────────────────

	const handlePublish = async () => {
		setPublishing(true)
		setError(null)
		try {
			const result = await rpc.request.publishIdentity()
			if (result.error) {
				setError(result.error)
			} else if (result.bapId) {
				setOwnBapId(result.bapId)
			}
		} catch (err) {
			setError(
				err instanceof Error ? err.message : 'Failed to publish identity',
			)
		} finally {
			setPublishing(false)
		}
	}

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

			{!ownBapId ? (
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
						<BapAvatar bapId={ownBapId} size={64} />
						<div className="flex flex-col gap-1 min-w-0">
							<span
								className="text-foreground font-semibold"
								style={{ fontFamily: 'var(--font-sans)', fontSize: 14 }}
							>
								{truncate(ownBapId, 10, 8)}
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
						<DetailRow label="BAP ID" value={truncate(ownBapId, 10, 8)} mono />
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
