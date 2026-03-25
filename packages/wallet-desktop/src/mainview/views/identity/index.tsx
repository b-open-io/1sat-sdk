import Avatar from 'sigma-avatars'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Empty } from '@/components/ui/empty'
import { ImageSelectionModal } from '@/components/blocks/image-selection-modal'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { BitcoinAvatar } from '@/components/blocks/bitcoin-avatar'
import { ProfileEditor } from '@/components/blocks/profile-editor'
import { FollowButton } from '@/components/blocks/follow-button'
import type { FollowResult } from '@/components/blocks/follow-button'
import type { BapProfile } from '@/components/blocks/profile-card/use-profile-card'
import { cn } from '@/lib/utils'
import {
	Camera,
	ExternalLink,
	ImageIcon,
	Loader2,
	MessageCircle,
	Pencil,
	Send,
	Trash2,
	UserCircle2,
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import type { DraftProfile } from '../../../shared/types'
import { STACK_URL } from '../../../shared/constants'
import { rpc } from '../../rpc'

// --- Helpers ----------------------------------------------------------------

const THEME_COLORS = [
	'var(--chart-1)',
	'var(--chart-2)',
	'var(--chart-3)',
	'var(--chart-4)',
	'var(--chart-5)',
]

function truncate(value: string, head = 8, tail = 6): string {
	if (value.length <= head + tail + 3) return value
	return `${value.slice(0, head)}...${value.slice(-tail)}`
}

function parseProfile(raw: Record<string, unknown>): BapProfile {
	return {
		name: typeof raw.name === 'string' ? raw.name : undefined,
		alternateName:
			typeof raw.alternateName === 'string' ? raw.alternateName : undefined,
		givenName: typeof raw.givenName === 'string' ? raw.givenName : undefined,
		familyName:
			typeof raw.familyName === 'string' ? raw.familyName : undefined,
		description:
			typeof raw.description === 'string' ? raw.description : undefined,
		image: typeof raw.image === 'string' ? raw.image : undefined,
		url: typeof raw.url === 'string' ? raw.url : undefined,
	}
}

function parseBanner(raw: Record<string, unknown>): string | undefined {
	const banner = raw.banner ?? raw.coverImage
	return typeof banner === 'string' ? banner : undefined
}

function buildDisplayName(profile: BapProfile): string | undefined {
	if (profile.name) return profile.name
	if (profile.givenName || profile.familyName) {
		return [profile.givenName, profile.familyName].filter(Boolean).join(' ')
	}
	return undefined
}

function profileTypeLabel(
	raw: Record<string, unknown> | DraftProfile | null,
): string {
	if (!raw) return 'Person'
	const t = (raw as Record<string, unknown>)['@type']
	return t === 'Organization' ? 'Organization' : 'Person'
}

// ImageSelectionModal is imported from the standalone component
// which has Ordinals, URL, and Upload tabs

// --- DetailRow --------------------------------------------------------------

function DetailRow({
	label,
	value,
	mono = false,
	href,
}: {
	label: string
	value: string
	mono?: boolean
	href?: string
}) {
	return (
		<div className="flex items-center justify-between gap-4 py-3">
			<span className="shrink-0 text-xs text-muted-foreground">{label}</span>
			{href ? (
				<a
					href={href}
					target="_blank"
					rel="noopener noreferrer"
					className="flex items-center gap-1.5 text-right text-xs text-primary break-all hover:underline"
				>
					{value}
					<ExternalLink className="h-3 w-3 shrink-0" />
				</a>
			) : (
				<span
					className={cn(
						'text-right text-xs text-foreground break-all',
						mono && 'font-mono',
					)}
				>
					{value}
				</span>
			)}
		</div>
	)
}

// --- ProfileAvatar ----------------------------------------------------------

function ProfileAvatar({
	identityKey,
	imageUrl,
	size = 160,
}: {
	identityKey: string
	imageUrl?: string
	size?: number
}) {
	const [imgError, setImgError] = useState(false)

	useEffect(() => {
		setImgError(false)
	}, [imageUrl])

	if (imageUrl && !imgError) {
		return (
			<img
				src={imageUrl}
				alt="Profile"
				className="h-full w-full object-cover"
				width={size}
				height={size}
				onError={() => setImgError(true)}
			/>
		)
	}

	return (
		<Avatar
			colors={THEME_COLORS}
			name={identityKey}
			size={size}
			variant="pixel"
		/>
	)
}

// --- OtherProfileView -------------------------------------------------------

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
					`${STACK_URL}/1sat/bap/profile/${encodeURIComponent(targetBapId)}`,
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

	const handleFollow = useCallback(
		async (bapId: string): Promise<FollowResult> => {
			setFollowError(null)
			const result = await rpc.request.createSocialPost({
				content: `follow:${bapId}`,
			})
			if (result.error) {
				return { error: result.error }
			}
			return { txid: result.txid }
		},
		[],
	)

	const displayName =
		profile?.name ?? profile?.alternateName ?? truncate(targetBapId, 10, 8)

	return (
		<div className="mx-auto w-full max-w-3xl px-6 py-8">
			<h1 className="mb-6 text-xl font-semibold text-foreground">Profile</h1>

			{error && (
				<div className="mb-6 rounded-md border border-destructive px-3 py-2 font-mono text-xs text-destructive">
					{error}
				</div>
			)}

			{loading ? (
				<div className="space-y-4">
					<div className="flex items-center gap-4">
						<Skeleton className="h-16 w-16 rounded-full" />
						<div className="space-y-2">
							<Skeleton className="h-4 w-40" />
							<Skeleton className="h-3 w-24" />
						</div>
					</div>
					<Skeleton className="h-20 w-full" />
				</div>
			) : (
				<div className="space-y-6">
					{/* Profile header */}
					<div className="flex items-center justify-between gap-4">
						<div className="flex items-center gap-4 min-w-0">
							<BitcoinAvatar
								address={targetBapId}
								imageUrl={profile?.image}
								size="xl"
							/>
							<div className="flex flex-col gap-1 min-w-0">
								<span className="text-base font-semibold text-foreground truncate">
									{displayName}
								</span>
								{profile?.alternateName &&
									profile.alternateName !== displayName && (
										<span className="text-sm text-muted-foreground truncate">
											{profile.alternateName}
										</span>
									)}
								<Badge variant="secondary" className="w-fit font-mono text-xs">
									{truncate(targetBapId, 10, 8)}
								</Badge>
							</div>
						</div>

						<div className="shrink-0 flex items-center gap-2">
							<FollowButton
								bapId={targetBapId}
								variant="compact"
								onFollow={handleFollow}
								onError={(err) => setFollowError(err.message)}
							/>
							<Button
								variant="outline"
								size="sm"
								onClick={handleMessage}
								className="flex items-center gap-2"
							>
								<MessageCircle className="h-3.5 w-3.5" />
								Message
							</Button>
						</div>
					</div>

					{followError && (
						<div className="rounded-md border border-destructive px-3 py-2 font-mono text-xs text-destructive">
							{followError}
						</div>
					)}

					{/* About */}
					{profile?.description && (
						<Card>
							<CardContent className="pt-6">
								<p className="text-sm leading-relaxed text-foreground">
									{profile.description}
								</p>
							</CardContent>
						</Card>
					)}

					{/* Details */}
					<Card>
						<CardContent className="pt-6">
							<DetailRow
								label="BAP ID"
								value={truncate(targetBapId, 10, 8)}
								mono
							/>
							{profile?.url && (
								<>
									<Separator />
									<DetailRow
										label="Website"
										value={profile.url}
										href={profile.url}
									/>
								</>
							)}
						</CardContent>
					</Card>
				</div>
			)}
		</div>
	)
}

// --- OwnProfileView ---------------------------------------------------------

interface OwnProfileViewProps {
	bapId: string
	identityKey: string
	profile: Record<string, unknown> | null
	isPublished: boolean
	onPublish: () => void
	publishing: boolean
	onRefresh: () => void
}

function OwnProfileView({
	bapId,
	identityKey,
	profile,
	isPublished,
	onPublish,
	publishing,
	onRefresh,
}: OwnProfileViewProps) {
	const [editorOpen, setEditorOpen] = useState(false)
	const [draft, setDraft] = useState<DraftProfile | null>(null)
	const [hasDraft, setHasDraft] = useState(false)
	const [publishingDraft, setPublishingDraft] = useState(false)
	const [discarding, setDiscarding] = useState(false)
	const [feedback, setFeedback] = useState<{
		type: 'success' | 'error'
		text: string
	} | null>(null)
	const [bannerModalOpen, setBannerModalOpen] = useState(false)
	const [avatarModalOpen, setAvatarModalOpen] = useState(false)

	const parsed = profile ? parseProfile(profile) : null
	const bannerUrl = profile ? parseBanner(profile) : undefined
	const displayName =
		parsed?.name ??
		parsed?.alternateName ??
		buildDisplayName(parsed ?? {}) ??
		truncate(bapId, 10, 8)

	// Check for a draft on mount
	const fetchDraft = useCallback(async () => {
		try {
			const result = await rpc.request.getDraftProfile()
			setDraft(result.profile)
			setHasDraft(result.profile !== null)
		} catch {
			// Draft check is best-effort
		}
	}, [])

	useEffect(() => {
		fetchDraft()
	}, [fetchDraft])

	const handlePublishDraft = useCallback(async () => {
		setPublishingDraft(true)
		setFeedback(null)
		try {
			const result = await rpc.request.publishProfile()
			if (result.error) {
				setFeedback({ type: 'error', text: result.error })
			} else {
				setFeedback({
					type: 'success',
					text: result.txid
						? `Published in tx ${result.txid.slice(0, 12)}...`
						: 'Profile published.',
				})
				setHasDraft(false)
				setDraft(null)
				onRefresh()
			}
		} catch (err) {
			setFeedback({
				type: 'error',
				text: err instanceof Error ? err.message : 'Failed to publish profile',
			})
		} finally {
			setPublishingDraft(false)
		}
	}, [onRefresh])

	const handleDiscard = useCallback(async () => {
		setDiscarding(true)
		setFeedback(null)
		try {
			const result = await rpc.request.discardDraftProfile()
			if (result.success) {
				setHasDraft(false)
				setDraft(null)
				setFeedback({ type: 'success', text: 'Draft discarded.' })
			}
		} catch (err) {
			setFeedback({
				type: 'error',
				text: err instanceof Error ? err.message : 'Failed to discard draft',
			})
		} finally {
			setDiscarding(false)
		}
	}, [])

	const handleEditorSaved = useCallback(() => {
		fetchDraft()
	}, [fetchDraft])

	const handleBannerSave = useCallback(
		(url: string) => {
			// Save banner as part of a draft profile update
			const current: DraftProfile = draft ?? {
				'@type':
					(profile?.['@type'] as 'Person' | 'Organization') ?? 'Person',
				alternateName: parsed?.alternateName,
				description: parsed?.description,
				image: parsed?.image,
				url: parsed?.url,
				givenName: parsed?.givenName,
				familyName: parsed?.familyName,
			}
			// Banner is stored in the profile record but not in DraftProfile type
			// We pass it through as an extra field for the draft save
			void rpc.request
				.saveDraftProfile({
					profile: { ...current, banner: url } as DraftProfile,
				})
				.then(() => {
					fetchDraft()
					onRefresh()
				})
		},
		[draft, profile, parsed, fetchDraft, onRefresh],
	)

	const handleAvatarSave = useCallback(
		(url: string) => {
			const current: DraftProfile = draft ?? {
				'@type':
					(profile?.['@type'] as 'Person' | 'Organization') ?? 'Person',
				alternateName: parsed?.alternateName,
				description: parsed?.description,
				image: parsed?.image,
				url: parsed?.url,
				givenName: parsed?.givenName,
				familyName: parsed?.familyName,
			}
			void rpc.request
				.saveDraftProfile({ profile: { ...current, image: url } })
				.then(() => {
					fetchDraft()
					onRefresh()
				})
		},
		[draft, profile, parsed, fetchDraft, onRefresh],
	)

	// Build the current profile for the editor (merge published + draft)
	const editorProfile: DraftProfile | null = draft ?? {
		'@type':
			(profile?.['@type'] as 'Person' | 'Organization') ?? 'Person',
		alternateName: parsed?.alternateName,
		description: parsed?.description,
		image: parsed?.image,
		url: parsed?.url,
		givenName: parsed?.givenName,
		familyName: parsed?.familyName,
	}

	return (
		<>
			<div className="space-y-6">
				{/* ---- Profile Hero ---- */}
				<div className="relative">
					{/* Banner */}
					<div className="relative h-48 w-full overflow-hidden rounded-t-xl bg-gradient-to-r from-chart-1/40 to-chart-3/40 md:h-64">
						{bannerUrl && (
							<img
								src={bannerUrl}
								alt="Profile banner"
								className="h-full w-full object-cover object-center"
							/>
						)}
						<Button
							className="absolute top-4 right-4 z-10"
							onClick={() => setBannerModalOpen(true)}
							size="sm"
							variant="secondary"
						>
							<ImageIcon className="mr-2 h-4 w-4" />
							Edit Banner
						</Button>
					</div>

					{/* Avatar overlapping the banner */}
					<div className="relative z-10 -mt-16 flex justify-center px-4 md:-mt-20">
						<div className="relative">
							<div className="h-32 w-32 overflow-hidden rounded-full border-4 border-background shadow-lg md:h-40 md:w-40">
								<ProfileAvatar
									identityKey={identityKey}
									imageUrl={parsed?.image}
									size={160}
								/>
							</div>
							<Button
								className="absolute right-0 bottom-0"
								onClick={() => setAvatarModalOpen(true)}
								size="icon"
								variant="secondary"
							>
								<Camera className="h-4 w-4" />
							</Button>
						</div>
					</div>

					{/* Centered user info */}
					<div className="mt-4 space-y-2 text-center">
						<h2 className="text-2xl font-bold md:text-3xl text-foreground">
							{displayName}
						</h2>
						{parsed?.description && (
							<p className="text-muted-foreground">
								{parsed.description}
							</p>
						)}
						<p className="font-mono text-sm text-muted-foreground">
							{bapId}
						</p>
					</div>
				</div>

				{/* Draft indicator */}
				{hasDraft && (
					<div className="flex items-center justify-between gap-4 rounded-lg border border-primary/30 bg-primary/5 px-4 py-3">
						<Badge variant="outline" className="border-primary text-primary">
							Draft — unpublished changes
						</Badge>
						<div className="flex items-center gap-2">
							<Button
								variant="ghost"
								size="sm"
								disabled={discarding}
								onClick={handleDiscard}
								className="text-muted-foreground"
							>
								{discarding ? (
									<Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
								) : (
									<Trash2 className="mr-1.5 h-3.5 w-3.5" />
								)}
								Discard Draft
							</Button>
							<Button
								size="sm"
								disabled={publishingDraft}
								onClick={handlePublishDraft}
							>
								{publishingDraft ? (
									<Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
								) : (
									<Send className="mr-1.5 h-3.5 w-3.5" />
								)}
								Publish to Blockchain
							</Button>
						</div>
					</div>
				)}

				{/* Feedback */}
				{feedback && (
					<div
						className={cn(
							'rounded-md border px-3 py-2 text-sm',
							feedback.type === 'error'
								? 'border-destructive/50 bg-destructive/10 text-destructive'
								: 'border-primary/50 bg-primary/10 text-primary',
						)}
					>
						{feedback.text}
					</div>
				)}

				{/* Actions */}
				<div className="flex justify-center gap-2">
					<Button
						variant="outline"
						size="sm"
						onClick={() => setEditorOpen(true)}
					>
						<Pencil data-icon="inline-start" />
						Edit Profile
					</Button>
					{!isPublished && (
						<Button
							size="sm"
							onClick={onPublish}
							disabled={publishing}
						>
							{publishing ? 'Publishing...' : 'Publish Identity'}
						</Button>
					)}
				</div>

				{/* Profile fields card */}
				<Card>
					<CardContent className="pt-6">
						<DetailRow label="Display Name" value={displayName} />
						<Separator />
						{parsed?.description && (
							<>
								<DetailRow label="Bio" value={parsed.description} />
								<Separator />
							</>
						)}
						{parsed?.url && (
							<>
								<DetailRow
									label="Website"
									value={parsed.url}
									href={parsed.url}
								/>
								<Separator />
							</>
						)}
						<DetailRow
							label="Type"
							value={profileTypeLabel(profile)}
						/>
						<Separator />
						<DetailRow
							label="BAP ID"
							value={truncate(bapId, 10, 8)}
							mono
						/>
					</CardContent>
				</Card>
			</div>

			<ProfileEditor
				open={editorOpen}
				onOpenChange={setEditorOpen}
				currentProfile={editorProfile}
				identityKey={identityKey}
				bapId={bapId}
				onSaved={handleEditorSaved}
			/>

			<ImageSelectionModal
				open={bannerModalOpen}
				onOpenChange={setBannerModalOpen}
				title="Edit Banner"
				aspectRatio={3}
				onImageSelected={handleBannerSave}
			/>

			<ImageSelectionModal
				open={avatarModalOpen}
				onOpenChange={setAvatarModalOpen}
				title="Edit Avatar"
				aspectRatio={1}
				onImageSelected={handleAvatarSave}
			/>
		</>
	)
}

// --- IdentityView (main export) ---------------------------------------------

interface IdentityViewProps {
	params?: { bapId?: string } & Record<string, string>
	onNavigate?: (url: string) => void
}

export function IdentityView({ params, onNavigate }: IdentityViewProps = {}) {
	const [ownBapId, setOwnBapId] = useState<string | null>(null)
	const [identityKey, setIdentityKey] = useState<string | null>(null)
	const [profile, setProfile] = useState<Record<string, unknown> | null>(null)
	const [loading, setLoading] = useState(true)
	const [publishing, setPublishing] = useState(false)
	const [error, setError] = useState<string | null>(null)

	const fetchIdentity = useCallback(async () => {
		try {
			const [identityResult, accountResult] = await Promise.all([
				rpc.request.getIdentity(),
				rpc.request.getActiveAccount(),
			])
			// Use on-chain BAP ID if available, otherwise fall back to registry bapId
			setOwnBapId(
				identityResult.bapId ??
				accountResult.account?.bapId ??
				null,
			)
			setProfile(identityResult.profile)
			setIdentityKey(accountResult.account?.identityKey ?? null)
			setError(null)
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Failed to load identity')
		} finally {
			setLoading(false)
		}
	}, [])

	useEffect(() => {
		fetchIdentity()
	}, [fetchIdentity])

	// If a bapId param is given and it differs from our own, show the other user view
	const targetBapId = params?.bapId
	const isViewingOther =
		!loading && targetBapId !== undefined && targetBapId !== ownBapId

	if (loading) {
		return (
			<div className="mx-auto w-full max-w-3xl px-6 py-8">
				<Skeleton className="mb-6 h-6 w-32" />
				{/* Banner skeleton */}
				<Skeleton className="h-48 w-full rounded-t-xl md:h-64" />
				{/* Avatar skeleton overlapping */}
				<div className="relative z-10 -mt-16 flex justify-center md:-mt-20">
					<Skeleton className="h-32 w-32 rounded-full border-4 border-background md:h-40 md:w-40" />
				</div>
				{/* Name / description skeleton */}
				<div className="mt-4 flex flex-col items-center gap-2">
					<Skeleton className="h-8 w-48" />
					<Skeleton className="h-4 w-64" />
					<Skeleton className="h-4 w-96" />
				</div>
				<Skeleton className="mt-6 h-40 w-full rounded-xl" />
			</div>
		)
	}

	if (isViewingOther && targetBapId) {
		return (
			<OtherProfileView targetBapId={targetBapId} onNavigate={onNavigate} />
		)
	}

	// --- Own identity view ----------------------------------------------------

	const handlePublish = async () => {
		setPublishing(true)
		setError(null)
		try {
			const result = await rpc.request.publishIdentity()
			if (result.error) {
				setError(result.error)
			} else if (result.bapId) {
				setOwnBapId(result.bapId)
				fetchIdentity()
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
		<div className="mx-auto w-full max-w-3xl px-6 py-8">
			<h1 className="mb-6 text-xl font-semibold text-foreground">Identity</h1>

			{error && (
				<div className="mb-6 rounded-md border border-destructive px-3 py-2 font-mono text-xs text-destructive">
					{error}
				</div>
			)}

			{ownBapId ? (
				<OwnProfileView
					bapId={ownBapId}
					identityKey={identityKey ?? ownBapId}
					profile={profile}
					isPublished={Boolean(profile)}
					onPublish={handlePublish}
					publishing={publishing}
					onRefresh={fetchIdentity}
				/>
			) : identityKey ? (
				<OwnProfileView
					bapId={identityKey.slice(0, 20)}
					identityKey={identityKey}
					profile={null}
					isPublished={false}
					onPublish={handlePublish}
					publishing={publishing}
					onRefresh={fetchIdentity}
				/>
			) : (
				<Empty
					icon={UserCircle2}
					title="No identity available"
					description="Create or import a wallet to set up your identity."
				/>
			)}
		</div>
	)
}
