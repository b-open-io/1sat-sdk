import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { MessageCircle } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { STACK_URL } from '../../../shared/constants'
import { FollowButton } from '../../components/blocks/follow-button'
import type { FollowResult } from '../../components/blocks/follow-button'
import type { BapProfile } from '../../components/blocks/profile-card/use-profile-card'
import { PostCardUI } from '../../components/blocks/social-feed/post-card-ui'
import type { SocialPost } from '../../components/blocks/social-feed/use-social-feed'
import { rpc } from '../../rpc'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function truncate(value: string, head = 8, tail = 6): string {
	if (value.length <= head + tail + 3) return value
	return `${value.slice(0, head)}...${value.slice(-tail)}`
}

function getInitial(bapId: string): string {
	return bapId.slice(0, 1).toUpperCase()
}

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

// ─── Sub-components ───────────────────────────────────────────────────────────

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

function BapAvatar({
	bapId,
	imageUrl,
	size = 80,
}: {
	bapId: string
	imageUrl?: string
	size?: number
}) {
	const hue = getBapHue(bapId)
	const hue2 = (hue + 40) % 360

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
			className="flex items-center justify-center shrink-0 font-semibold select-none"
			style={{
				width: size,
				height: size,
				borderRadius: '50%',
				background: `linear-gradient(135deg, oklch(0.55 0.18 ${hue}), oklch(0.65 0.22 ${hue2}))`,
				fontFamily: 'var(--font-sans)',
				fontSize: size * 0.38,
				color: 'white',
			}}
			aria-hidden="true"
		>
			{getInitial(bapId)}
		</div>
	)
}

function StatPill({ label, value }: { label: string; value: number | string }) {
	return (
		<div className="flex flex-col items-center gap-0.5">
			<span
				className="text-foreground font-semibold tabular-nums"
				style={{ fontFamily: 'var(--font-sans)', fontSize: 16 }}
			>
				{value}
			</span>
			<span
				className="text-muted-foreground"
				style={{ fontFamily: 'var(--font-sans)', fontSize: 11 }}
			>
				{label}
			</span>
		</div>
	)
}

// ─── Raw post types mirrored locally ─────────────────────────────────────────

interface RawAipEntry {
	algorithm?: string
	address?: string
	bapId?: string
}

interface RawPost {
	txid: string
	B?: { content?: string }
	MAP?: { app?: string; type?: string; channel?: string }
	AIP?: RawAipEntry[]
	timestamp?: number
	blk?: { t?: number }
	likes?: number
	replies?: number
}

function parsePost(raw: RawPost): SocialPost {
	return {
		txid: raw.txid,
		content: raw.B?.content ?? '',
		timestamp: raw.timestamp ?? raw.blk?.t ?? 0,
		app: raw.MAP?.app ?? '',
		type: raw.MAP?.type ?? 'post',
		channel: raw.MAP?.channel,
		signers: (raw.AIP ?? []).map((a) => ({
			algorithm: a.algorithm ?? 'BITCOIN_ECDSA',
			address: a.address ?? '',
			bapId: a.bapId,
		})),
		likes: raw.likes,
		replies: raw.replies,
	}
}

// ─── ExternalProfileView ──────────────────────────────────────────────────────

interface ExternalProfileViewProps {
	params?: Record<string, string>
	onNavigate?: (url: string) => void
}

export function ExternalProfileView({
	params,
	onNavigate,
}: ExternalProfileViewProps = {}) {
	const bapId = params?.bapId ?? ''

	const [profile, setProfile] = useState<BapProfile | null>(null)
	const [profileLoading, setProfileLoading] = useState(true)
	const [profileError, setProfileError] = useState<string | null>(null)

	const [posts, setPosts] = useState<SocialPost[]>([])
	const [postsLoading, setPostsLoading] = useState(true)

	const [followError, setFollowError] = useState<string | null>(null)

	// ── Fetch profile ────────────────────────────────────────────────────────

	useEffect(() => {
		if (!bapId) return
		let cancelled = false
		setProfileLoading(true)
		setProfileError(null)

		async function fetchProfile() {
			try {
				const res = await fetch(
					`${STACK_URL}/1sat/bap/${encodeURIComponent(bapId)}`,
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
					setProfileError(
						err instanceof Error ? err.message : 'Failed to load profile',
					)
				}
			} finally {
				if (!cancelled) setProfileLoading(false)
			}
		}

		void fetchProfile()
		return () => {
			cancelled = true
		}
	}, [bapId])

	// ── Fetch recent posts ───────────────────────────────────────────────────

	useEffect(() => {
		if (!bapId) return
		let cancelled = false
		setPostsLoading(true)

		async function fetchPosts() {
			try {
				const res = await fetch(
					`${STACK_URL}/1sat/bap/posts/${encodeURIComponent(bapId)}?limit=10`,
				)
				if (!res.ok) {
					// Non-fatal — just show empty state
					if (!cancelled) setPosts([])
					return
				}
				const raw: RawPost[] = await res.json()
				if (cancelled) return
				setPosts(raw.map(parsePost))
			} catch {
				if (!cancelled) setPosts([])
			} finally {
				if (!cancelled) setPostsLoading(false)
			}
		}

		void fetchPosts()
		return () => {
			cancelled = true
		}
	}, [bapId])

	// ── Action handlers ──────────────────────────────────────────────────────

	const handleMessage = useCallback(() => {
		if (!bapId) return
		onNavigate?.(`1sat://dm?bapId=${encodeURIComponent(bapId)}`)
	}, [bapId, onNavigate])

	const handleFollow = useCallback(async (): Promise<FollowResult> => {
		setFollowError(null)
		const result = await rpc.request.createSocialPost({
			content: `follow:${bapId}`,
		})
		if (result.error) return { error: result.error }
		return { txid: result.txid }
	}, [bapId])

	const handlePostAuthorClick = useCallback(
		(post: SocialPost) => {
			const authorBapId = post.signers?.[0]?.bapId
			if (authorBapId && authorBapId !== bapId) {
				onNavigate?.(
					`1sat://identity/profile-external?bapId=${encodeURIComponent(authorBapId)}`,
				)
			}
		},
		[bapId, onNavigate],
	)

	// ── Guard: no bapId ──────────────────────────────────────────────────────

	if (!bapId) {
		return (
			<div
				className="mx-auto w-full py-8 px-6 flex items-center justify-center"
				style={{ maxWidth: 480 }}
			>
				<p
					className="text-destructive"
					style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}
				>
					Missing bapId parameter.
				</p>
			</div>
		)
	}

	// ── Computed values ──────────────────────────────────────────────────────

	const displayName =
		profile?.name ?? profile?.alternateName ?? truncate(bapId, 10, 8)

	// ── Render ───────────────────────────────────────────────────────────────

	return (
		<div
			className="mx-auto w-full py-8 px-6 flex flex-col gap-6"
			style={{ maxWidth: 480 }}
		>
			{/* Error banner */}
			{profileError && (
				<div
					className="border border-destructive text-destructive px-3 py-2"
					style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}
					role="alert"
				>
					{profileError}
				</div>
			)}

			{profileLoading ? (
				<p
					className="text-muted-foreground text-center"
					style={{ fontFamily: 'var(--font-sans)', fontSize: 12 }}
				>
					Loading profile...
				</p>
			) : (
				<>
					{/* ── Profile header ──────────────────────────────────────────── */}
					<div className="flex flex-col items-center gap-3">
						{/* Avatar */}
						<BapAvatar bapId={bapId} imageUrl={profile?.image} size={80} />

						{/* Display name */}
						<h1
							className="text-foreground font-bold text-center"
							style={{ fontFamily: 'var(--font-sans)', fontSize: 20 }}
						>
							{displayName}
						</h1>

						{/* BAP ID — full width, centered, mono */}
						<p
							className={cn(
								'text-muted-foreground text-center w-full break-all',
							)}
							style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}
						>
							{bapId}
						</p>

						{/* Description */}
						{profile?.description && (
							<p
								className="text-muted-foreground text-center"
								style={{
									fontFamily: 'var(--font-sans)',
									fontSize: 13,
									lineHeight: 1.5,
								}}
							>
								{profile.description}
							</p>
						)}
					</div>

					{/* ── Actions row ─────────────────────────────────────────────── */}
					<div className="flex items-center justify-center gap-3">
						<Button onClick={handleMessage} className="flex items-center gap-2">
							<MessageCircle size={14} aria-hidden="true" />
							Message
						</Button>
						<FollowButton
							bapId={bapId}
							onFollow={handleFollow}
							onError={(err) => setFollowError(err.message)}
						/>
					</div>

					{/* Follow error */}
					{followError && (
						<div
							className="border border-destructive text-destructive px-3 py-2"
							style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}
							role="alert"
						>
							{followError}
						</div>
					)}

					{/* ── Stats row ───────────────────────────────────────────────── */}
					<div className="flex items-center justify-center gap-8 py-4 border-y border-border">
						<StatPill label="posts" value={posts.length} />
						<StatPill label="followers" value="—" />
						<StatPill label="following" value="—" />
					</div>

					{/* ── Website ─────────────────────────────────────────────────── */}
					{profile?.url && (
						<div className="flex flex-col gap-1">
							<SectionHeader label="Website" />
							<a
								href={profile.url}
								target="_blank"
								rel="noopener noreferrer"
								className="text-foreground hover:underline break-all"
								style={{ fontFamily: 'var(--font-sans)', fontSize: 13 }}
							>
								{profile.url}
							</a>
						</div>
					)}

					{/* ── Recent posts ────────────────────────────────────────────── */}
					<div className="flex flex-col gap-3">
						<SectionHeader label="Recent Posts" />

						{postsLoading ? (
							<p
								className="text-muted-foreground"
								style={{ fontFamily: 'var(--font-sans)', fontSize: 12 }}
							>
								Loading posts...
							</p>
						) : posts.length === 0 ? (
							<p
								className="text-muted-foreground"
								style={{ fontFamily: 'var(--font-sans)', fontSize: 12 }}
							>
								No posts yet.
							</p>
						) : (
							<div className="flex flex-col border-t border-border -mx-6">
								{posts.map((post) => (
									<div key={post.txid} className="border-b border-border">
										<PostCardUI
											post={post}
											onAuthorClick={handlePostAuthorClick}
											showReplyButton={false}
										/>
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
