import { AlertCircle, RefreshCw } from 'lucide-react'
import type { ReactNode } from 'react'
import { BitcoinAvatar } from '@/components/blocks/bitcoin-avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import type { BapProfile } from './use-profile-card'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ProfileCardUIProps {
	/** Optional CSS class name */
	className?: string
	/** BAP ID (~27 char base58 string) */
	bapId: string | null
	/** Parsed profile data */
	profile: BapProfile | null
	/** Current signing address for avatar resolution */
	currentAddress: string | null
	/** Whether the profile is loading */
	isLoading: boolean
	/** Error from fetching */
	error: Error | null
	/** Retry callback for error state */
	onRetry?: () => void
	/** Render prop for a follow button or other action in the header */
	renderAction?: (bapId: string) => ReactNode
}

// ---------------------------------------------------------------------------
// Loading skeleton
// ---------------------------------------------------------------------------

function ProfileCardSkeleton({ className }: { className?: string }) {
	return (
		<Card className={cn('w-full max-w-sm', className)}>
			<CardHeader className="flex flex-row items-start gap-4 pb-3">
				<Skeleton className="size-16 shrink-0 rounded-full" />
				<div className="flex-1 flex flex-col gap-2 pt-1">
					<Skeleton className="h-5 w-32" />
					<Skeleton className="h-4 w-24" />
				</div>
			</CardHeader>
			<CardContent className="flex flex-col gap-3">
				<Skeleton className="h-4 w-full" />
				<Skeleton className="h-4 w-3/4" />
				<Separator />
				<Skeleton className="h-4 w-48" />
			</CardContent>
		</Card>
	)
}

// ---------------------------------------------------------------------------
// Error state
// ---------------------------------------------------------------------------

function ProfileCardError({
	className,
	error,
	onRetry,
}: {
	className?: string
	error: Error
	onRetry?: () => void
}) {
	return (
		<Card className={cn('w-full max-w-sm', className)}>
			<CardContent className="flex flex-col items-center gap-3 py-8">
				<div className="flex size-10 items-center justify-center rounded-full bg-destructive/10">
					<AlertCircle className="size-5 text-destructive" />
				</div>
				<p className="text-sm text-muted-foreground text-center">
					{error.message}
				</p>
				{onRetry && (
					<Button variant="outline" size="sm" onClick={onRetry}>
						<RefreshCw data-icon="inline-start" />
						Retry
					</Button>
				)}
			</CardContent>
		</Card>
	)
}

// ---------------------------------------------------------------------------
// Main UI component
// ---------------------------------------------------------------------------

export function ProfileCardUI({
	className,
	bapId,
	profile,
	currentAddress,
	isLoading,
	error,
	onRetry,
	renderAction,
}: ProfileCardUIProps) {
	if (isLoading) {
		return <ProfileCardSkeleton className={className} />
	}

	if (error) {
		return (
			<ProfileCardError className={className} error={error} onRetry={onRetry} />
		)
	}

	if (!bapId) {
		return (
			<Card className={cn('w-full max-w-sm', className)}>
				<CardContent className="flex flex-col items-center gap-2 py-8">
					<p className="text-sm text-muted-foreground">No identity found</p>
				</CardContent>
			</Card>
		)
	}

	const displayName =
		profile?.name ?? profile?.alternateName ?? bapId.slice(0, 8)
	const handle = profile?.alternateName
		? profile.alternateName.startsWith('@')
			? profile.alternateName
			: `@${profile.alternateName}`
		: null
	const avatarAddress = currentAddress ?? bapId

	return (
		<Card className={cn('w-full max-w-sm', className)}>
			<CardHeader className="flex flex-row items-start gap-4 pb-3">
				<BitcoinAvatar
					address={avatarAddress}
					imageUrl={profile?.image}
					size="lg"
					className="shrink-0"
				/>
				<div className="flex-1 min-w-0 flex flex-col gap-1 pt-0.5">
					<div className="flex items-start justify-between gap-2">
						<div className="min-w-0">
							<p className="text-base font-semibold leading-tight truncate">
								{displayName}
							</p>
							{handle && (
								<p className="text-sm text-muted-foreground truncate">
									{handle}
								</p>
							)}
						</div>
						{renderAction && bapId ? (
							<div className="shrink-0">{renderAction(bapId)}</div>
						) : null}
					</div>
				</div>
			</CardHeader>

			<CardContent className="flex flex-col gap-3 pt-0">
				{profile?.description && (
					<p className="text-sm text-muted-foreground leading-relaxed">
						{profile.description}
					</p>
				)}

				<Separator />

				<div className="flex flex-col gap-1.5">
					<p className="text-xs font-medium text-muted-foreground">BAP ID</p>
					<Badge
						variant="secondary"
						className="font-mono text-xs break-all whitespace-normal"
					>
						{bapId}
					</Badge>
				</div>

				{profile?.url && (
					<a
						href={profile.url}
						target="_blank"
						rel="noopener noreferrer"
						className="inline-block text-xs text-primary hover:underline transition-colors"
					>
						{profile.url}
					</a>
				)}
			</CardContent>
		</Card>
	)
}
