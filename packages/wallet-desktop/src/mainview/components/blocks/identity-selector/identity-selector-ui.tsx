import { BitcoinAvatar } from '@/components/blocks/bitcoin-avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { AlertCircle, Check, Plus } from 'lucide-react'
import type { IdentityEntry } from './use-identity-selector'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface IdentitySelectorUIProps {
	/** Optional CSS class name */
	className?: string
	/** List of available identities */
	identities: IdentityEntry[]
	/** Currently active BAP ID */
	activeBapId: string | null
	/** Whether identities are loading */
	isLoading: boolean
	/** Error if fetch failed */
	error: Error | null
	/** Called when an identity row is clicked */
	onSelect: (bapId: string) => void
	/** Called when "Add identity" is clicked */
	onAddIdentity: () => void
	/** Whether to show the "Add identity" button (default: true) */
	showAddIdentity?: boolean
}

// ---------------------------------------------------------------------------
// Loading skeleton
// ---------------------------------------------------------------------------

function IdentitySelectorSkeleton({ className }: { className?: string }) {
	return (
		<Card className={cn('w-full max-w-sm', className)}>
			<CardContent className="flex flex-col gap-1 p-2">
				{[0, 1, 2].map((i) => (
					<div
						key={i}
						className="flex items-center gap-3 rounded-md px-3 py-2.5"
					>
						<Skeleton className="size-10 shrink-0 rounded-full" />
						<div className="flex-1 flex flex-col gap-1.5">
							<Skeleton className="h-4 w-24" />
							<Skeleton className="h-3 w-40" />
						</div>
					</div>
				))}
			</CardContent>
		</Card>
	)
}

// ---------------------------------------------------------------------------
// Error state
// ---------------------------------------------------------------------------

function IdentitySelectorError({
	className,
	error,
}: {
	className?: string
	error: Error
}) {
	return (
		<Card className={cn('w-full max-w-sm', className)}>
			<CardContent className="flex flex-col items-center gap-2 py-6">
				<AlertCircle className="size-5 text-destructive" />
				<p className="text-sm text-muted-foreground text-center">
					{error.message}
				</p>
			</CardContent>
		</Card>
	)
}

// ---------------------------------------------------------------------------
// Identity row
// ---------------------------------------------------------------------------

interface IdentityRowProps {
	identity: IdentityEntry
	isActive: boolean
	onSelect: (bapId: string) => void
}

function IdentityRow({ identity, isActive, onSelect }: IdentityRowProps) {
	const displayName = identity.name ?? identity.bapId.slice(0, 8)

	return (
		<button
			type="button"
			className={cn(
				'flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left transition-colors',
				isActive ? 'bg-accent text-accent-foreground' : 'hover:bg-muted/50',
			)}
			onClick={() => onSelect(identity.bapId)}
			aria-label={`Select identity ${displayName}`}
			aria-pressed={isActive}
		>
			<BitcoinAvatar
				address={identity.currentAddress}
				imageUrl={identity.imageUrl ?? undefined}
				size="md"
				className="shrink-0"
			/>

			<div className="flex-1 min-w-0 flex flex-col gap-0.5">
				<p className="text-sm font-medium leading-tight truncate">
					{displayName}
				</p>
				<Badge
					variant="secondary"
					className="font-mono text-[10px] max-w-full break-all whitespace-normal leading-tight"
				>
					{identity.bapId}
				</Badge>
			</div>

			{isActive && (
				<Check
					className="size-4 shrink-0 text-primary"
					aria-label="Active identity"
				/>
			)}
		</button>
	)
}

// ---------------------------------------------------------------------------
// Main UI component
// ---------------------------------------------------------------------------

export function IdentitySelectorUI({
	className,
	identities,
	activeBapId,
	isLoading,
	error,
	onSelect,
	onAddIdentity,
	showAddIdentity = true,
}: IdentitySelectorUIProps) {
	if (isLoading) {
		return <IdentitySelectorSkeleton className={className} />
	}

	if (error) {
		return <IdentitySelectorError className={className} error={error} />
	}

	if (identities.length === 0 && !showAddIdentity) {
		return (
			<Card className={cn('w-full max-w-sm', className)}>
				<CardContent className="flex flex-col items-center gap-2 py-6">
					<p className="text-sm text-muted-foreground">
						No identities available
					</p>
				</CardContent>
			</Card>
		)
	}

	return (
		<Card className={cn('w-full max-w-sm', className)}>
			<CardContent className="flex flex-col p-2">
				{identities.map((identity) => (
					<IdentityRow
						key={identity.bapId}
						identity={identity}
						isActive={identity.bapId === activeBapId}
						onSelect={onSelect}
					/>
				))}

				{showAddIdentity && (
					<>
						{identities.length > 0 && <Separator className="my-1" />}
						<Button
							variant="ghost"
							size="sm"
							className="w-full justify-start gap-2 text-muted-foreground hover:text-foreground"
							onClick={onAddIdentity}
						>
							<Plus data-icon="inline-start" />
							Add identity
						</Button>
					</>
				)}
			</CardContent>
		</Card>
	)
}
