import type { VariantProps } from 'class-variance-authority'
import { FollowButtonUI, type followButtonVariants } from './ui'
import { type FollowResult, useFollow } from './use-follow'

// ---------------------------------------------------------------------------
// Re-exports
// ---------------------------------------------------------------------------

export {
	FollowButtonUI,
	type FollowButtonUIProps,
	followButtonVariants,
} from './ui'
export {
	type FollowResult,
	type FollowState,
	type UseFollowOptions,
	type UseFollowReturn,
	useFollow,
} from './use-follow'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FollowButtonProps
	extends VariantProps<typeof followButtonVariants> {
	/** Additional CSS classes */
	className?: string
	/** BAP identity key of the user to follow */
	bapId: string
	/** Whether the current user is already following this user */
	isFollowing?: boolean
	/** Called to broadcast a follow action */
	onFollow: (bapId: string) => Promise<FollowResult>
	/** Called to broadcast an unfollow action */
	onUnfollow?: (bapId: string) => Promise<FollowResult>
	/** Called after a successful follow/unfollow */
	onToggled?: (following: boolean, result: FollowResult) => void
	/** Called on error */
	onError?: (error: Error) => void
	/** Disable the button */
	disabled?: boolean
	/** Labels for the three visual states */
	labels?: {
		follow?: string
		following?: string
		unfollow?: string
	}
}

// ---------------------------------------------------------------------------
// Composed component
// ---------------------------------------------------------------------------

/**
 * A follow/unfollow toggle button for BSocial identities.
 *
 * Renders three visual states:
 * - **Follow** (idle) -- primary CTA to follow a user
 * - **Following** (confirmed) -- subdued indicator that the user is followed
 * - **Unfollow** (hover on "Following") -- destructive action on hover
 *
 * Delegates transaction building to `onFollow`/`onUnfollow` callbacks.
 *
 * @example
 * ```tsx
 * import { FollowButton } from "@/components/blocks/follow-button"
 *
 * <FollowButton
 *   bapId="02abc..."
 *   isFollowing={false}
 *   onFollow={async (bapId) => {
 *     // build BSocial follow tx
 *     return { txid: "abc123..." }
 *   }}
 * />
 * ```
 */
export function FollowButton({
	variant = 'default',
	className,
	bapId,
	isFollowing = false,
	onFollow,
	onUnfollow,
	onToggled,
	onError,
	disabled = false,
	labels = {},
}: FollowButtonProps) {
	const hook = useFollow({
		bapId,
		isFollowing,
		onFollow,
		onUnfollow,
		onToggled,
		onError,
		labels,
	})

	return (
		<FollowButtonUI
			variant={variant}
			className={className}
			bapId={bapId}
			following={hook.following}
			showUnfollow={hook.showUnfollow}
			isLoading={hook.isLoading}
			currentLabel={hook.currentLabel}
			onClick={hook.handleClick}
			onMouseEnter={() => hook.setIsHovering(true)}
			onMouseLeave={() => hook.setIsHovering(false)}
			disabled={disabled}
		/>
	)
}
