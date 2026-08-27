import type { VariantProps } from 'class-variance-authority'
import { LikeButtonUI, type likeButtonVariants } from './ui'
import { type LikeResult, useLike } from './use-like'

// ---------------------------------------------------------------------------
// Re-exports
// ---------------------------------------------------------------------------

export { LikeButtonUI, type LikeButtonUIProps, likeButtonVariants } from './ui'
export {
	type LikeResult,
	type UseLikeOptions,
	type UseLikeReturn,
	useLike,
} from './use-like'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LikeButtonProps
	extends VariantProps<typeof likeButtonVariants> {
	/** Additional CSS classes */
	className?: string
	/** Transaction ID of the content to like */
	txid: string
	/** Current like count to display */
	count?: number
	/** Whether the current user has already liked this content */
	liked?: boolean
	/** Called to broadcast a like action */
	onLike: (txid: string) => Promise<LikeResult>
	/** Called to broadcast an unlike action */
	onUnlike?: (txid: string) => Promise<LikeResult>
	/** Called after a successful like/unlike */
	onToggled?: (liked: boolean, result: LikeResult) => void
	/** Called on error */
	onError?: (error: Error) => void
	/** Disable the button */
	disabled?: boolean
	/** Use thumbs-up icon instead of heart */
	useThumbsUp?: boolean
}

// ---------------------------------------------------------------------------
// Composed component
// ---------------------------------------------------------------------------

/**
 * An on-chain like/unlike toggle button for BSocial content.
 *
 * Delegates the actual transaction building and broadcasting to `onLike`
 * and `onUnlike` callbacks. Manages optimistic UI updates internally.
 *
 * @example
 * ```tsx
 * import { LikeButton } from "@/components/blocks/like-button"
 *
 * <LikeButton
 *   txid="abc123..."
 *   count={42}
 *   liked={false}
 *   onLike={async (txid) => {
 *     // build BSocial like tx and broadcast
 *     return { txid: "def456..." }
 *   }}
 * />
 * ```
 */
export function LikeButton({
	variant = 'default',
	className,
	txid,
	count = 0,
	liked = false,
	onLike,
	onUnlike,
	onToggled,
	onError,
	disabled = false,
	useThumbsUp = false,
}: LikeButtonProps) {
	const hook = useLike({
		txid,
		count,
		liked,
		onLike,
		onUnlike,
		onToggled,
		onError,
	})

	return (
		<LikeButtonUI
			variant={variant}
			className={className}
			isLiked={hook.isLiked}
			displayCount={hook.displayCount}
			isLoading={hook.isLoading}
			onToggle={hook.handleToggle}
			disabled={disabled}
			useThumbsUp={useThumbsUp}
		/>
	)
}
