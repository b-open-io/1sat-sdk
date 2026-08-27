import type { VariantProps } from 'class-variance-authority'
import { FriendButtonUI, type friendButtonVariants } from './ui'
import {
	type FriendResult,
	type FriendshipStatus,
	useFriend,
} from './use-friend'

// ---------------------------------------------------------------------------
// Re-exports
// ---------------------------------------------------------------------------

export {
	FriendButtonUI,
	type FriendButtonUIProps,
	friendButtonVariants,
} from './ui'
export {
	type FriendResult,
	type FriendshipStatus,
	type UseFriendOptions,
	type UseFriendReturn,
	useFriend,
} from './use-friend'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FriendButtonProps
	extends VariantProps<typeof friendButtonVariants> {
	/** Additional CSS classes */
	className?: string
	/** Identity key of the other user */
	identityKey: string
	/** Current friendship status */
	status: FriendshipStatus
	/** Called to send a friend request (creates a BSocial follow) */
	onAddFriend: (identityKey: string) => Promise<FriendResult>
	/** Called to accept an incoming request (creates a mutual follow + derives shared key) */
	onAccept?: (identityKey: string) => Promise<FriendResult>
	/** Called to decline an incoming request */
	onDecline?: (identityKey: string) => Promise<FriendResult>
	/** Called to remove an existing friend */
	onRemove?: (identityKey: string) => Promise<FriendResult>
	/** Called after any successful action with the new status */
	onStatusChange?: (newStatus: FriendshipStatus, result: FriendResult) => void
	/** Called on error */
	onError?: (error: Error) => void
	/** Disable the button */
	disabled?: boolean
}

// ---------------------------------------------------------------------------
// Composed component
// ---------------------------------------------------------------------------

/**
 * A friend request button with four states: Add Friend, Pending (sent),
 * Accept/Decline (received), and Friends.
 *
 * Uses BSocial follow protocol for friend requests. When both users follow
 * each other, they become "friends" and can derive shared encryption keys
 * via `getFriendPublicKey()` from `@1sat/actions`.
 *
 * @example
 * ```tsx
 * import { FriendButton } from "@/components/blocks/friend-button"
 *
 * <FriendButton
 *   identityKey="02abc..."
 *   status="none"
 *   onAddFriend={async (id) => {
 *     // create BSocial follow tx
 *     return { txid: "abc123..." }
 *   }}
 *   onAccept={async (id) => {
 *     // create mutual follow + derive shared key
 *     return { txid: "def456...", friendPublicKey: "03xyz..." }
 *   }}
 * />
 * ```
 */
export function FriendButton({
	variant = 'default',
	className,
	identityKey,
	status,
	onAddFriend,
	onAccept,
	onDecline,
	onRemove,
	onStatusChange,
	onError,
	disabled = false,
}: FriendButtonProps) {
	const hook = useFriend({
		identityKey,
		status,
		onAddFriend,
		onAccept,
		onDecline,
		onRemove,
		onStatusChange,
		onError,
	})

	return (
		<FriendButtonUI
			variant={variant}
			className={className}
			identityKey={identityKey}
			currentStatus={hook.currentStatus}
			isLoading={hook.isLoading}
			loadingAction={hook.loadingAction}
			isHovering={hook.isHovering}
			onMouseEnter={() => hook.setIsHovering(true)}
			onMouseLeave={() => hook.setIsHovering(false)}
			onAdd={hook.handleAdd}
			onAccept={hook.handleAccept}
			onDecline={hook.handleDecline}
			onRemove={hook.handleRemove}
			hasAccept={hook.hasAccept}
			hasDecline={hook.hasDecline}
			hasRemove={hook.hasRemove}
			disabled={disabled}
		/>
	)
}
