import Avatar from 'sigma-avatars'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Empty } from '@/components/ui/empty'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { BitcoinAvatar } from '@/components/blocks/bitcoin-avatar'
import { ProfileEditor } from '@/components/blocks/profile-editor'
import { FollowButton } from '@/components/blocks/follow-button'
import type { FollowResult } from '@/components/blocks/follow-button'
import type { BapProfile } from '@/components/blocks/profile-card/use-profile-card'
import { cn } from '@/lib/utils'
import {
	ExternalLink,
	Globe,
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
	onRefresh: () => void
}

function OwnProfileView({
	bapId,
	identityKey,
	profile,
	onRefresh,
}: OwnProfileViewProps) {
	const [editorOpen, setEditorOpen] = useState(false)
	const [draft, setDraft] = useState<DraftProfile | null>(null)
	const [hasDraft, setHasDraft] = useState(false)
	const [publishing, setPublishing] = useState(false)
	const [discarding, setDiscarding] = useState(false)
	const [feedback, setFeedback] = useState<{
		type: 'success' | 'error'
		text: string
	} | null>(null)

	const parsed = profile ? parseProfile(profile) : null
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

	const handlePublish = useCallback(async () => {
		setPublishing(true)
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
			setPublishing(false)
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
				{/* Hero section */}
				<div className="flex items-start gap-6">
					<div className="shrink-0">
						<Avatar
							name={identityKey}
							variant="marble"
							size={96}
							colors={THEME_COLORS}
							className="rounded-full"
						/>
					</div>
					<div className="flex flex-1 flex-col gap-2 min-w-0">
						<h2 className="text-2xl font-semibold text-foreground truncate">
							{displayName}
						</h2>
						<Badge variant="secondary" className="w-fit font-mono text-xs">
							{truncate(bapId, 10, 8)}
						</Badge>
						{parsed?.description && (
							<p className="mt-1 text-sm leading-relaxed text-muted-foreground">
								{parsed.description}
							</p>
						)}
						{parsed?.url && (
							<a
								href={parsed.url}
								target="_blank"
								rel="noopener noreferrer"
								className="mt-1 flex items-center gap-1.5 text-sm text-primary hover:underline"
							>
								<Globe className="h-3.5 w-3.5 shrink-0" />
								{parsed.url}
							</a>
						)}
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
								disabled={publishing}
								onClick={handlePublish}
							>
								{publishing ? (
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
				<div>
					<Button
						variant="outline"
						size="sm"
						onClick={() => setEditorOpen(true)}
					>
						<Pencil className="mr-1.5 h-3.5 w-3.5" />
						Edit Profile
					</Button>
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
			setOwnBapId(identityResult.bapId)
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
				<div className="flex items-center gap-6">
					<Skeleton className="h-24 w-24 rounded-full" />
					<div className="space-y-3">
						<Skeleton className="h-6 w-48" />
						<Skeleton className="h-4 w-32" />
						<Skeleton className="h-4 w-64" />
					</div>
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

			{!ownBapId ? (
				<Empty
					icon={UserCircle2}
					title="No identity published"
					description="Publish your identity to use social features and verified interactions."
					action={{
						label: publishing ? 'Publishing...' : 'Publish Identity',
						onClick: handlePublish,
					}}
				/>
			) : (
				<OwnProfileView
					bapId={ownBapId}
					identityKey={identityKey ?? ownBapId}
					profile={profile}
					onRefresh={fetchIdentity}
				/>
			)}
		</div>
	)
}
