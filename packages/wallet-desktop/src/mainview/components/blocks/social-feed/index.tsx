import { SocialFeedUI, type SocialFeedUIProps } from './social-feed-ui'
import { useSocialFeed } from './use-social-feed'

// ---------------------------------------------------------------------------
// Re-exports
// ---------------------------------------------------------------------------

export { PostCardUI, type PostCardUIProps } from './post-card-ui'
export { SocialFeedUI, type SocialFeedUIProps } from './social-feed-ui'
export {
	type AuthorProfile,
	type PostSigner,
	type SocialPost,
	type UseSocialFeedOptions,
	type UseSocialFeedReturn,
	useSocialFeed,
} from './use-social-feed'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SocialFeedProps
	extends Omit<
		SocialFeedUIProps,
		| 'posts'
		| 'isLoading'
		| 'isLoadingMore'
		| 'error'
		| 'hasMore'
		| 'onLoadMore'
		| 'onRefresh'
	> {
	/** Channel to filter posts by */
	channel?: string
	/** Search query string */
	query?: string
	/** Number of posts per page (default: 20) */
	limit?: number
	/** Base URL for the 1sat-stack API (default: https://api.1sat.app) */
	apiUrl?: string
	/** Whether to auto-fetch on mount (default: true) */
	autoFetch?: boolean
}

// ---------------------------------------------------------------------------
// Composed component
// ---------------------------------------------------------------------------

/**
 * A chronological feed of on-chain BSocial posts.
 *
 * Fetches posts from the 1sat-stack API and renders them in a vertical feed
 * with avatar, author name, timestamp, content, and action buttons.
 * Supports infinite scroll pagination, channel filtering, and custom
 * like button rendering via the `renderLikeButton` prop.
 *
 * @example
 * ```tsx
 * import { SocialFeed } from "@/components/blocks/social-feed"
 *
 * <SocialFeed
 *   channel="general"
 *   onPostClick={(post) => console.log("Clicked:", post.txid)}
 *   onAuthorClick={(post) => console.log("Author:", post.signers?.[0])}
 * />
 * ```
 *
 * @example
 * ```tsx
 * // With custom like button
 * import { SocialFeed } from "@/components/blocks/social-feed"
 * import { LikeButton } from "@/components/blocks/like-button"
 *
 * <SocialFeed
 *   renderLikeButton={(post) => (
 *     <LikeButton
 *       txid={post.txid}
 *       count={post.likes ?? 0}
 *       variant="text"
 *       onLike={async (txid) => {
 *         // broadcast BSocial like tx
 *         return { txid: "..." }
 *       }}
 *     />
 *   )}
 * />
 * ```
 */
export function SocialFeed({
	channel,
	query,
	limit,
	apiUrl,
	autoFetch,
	...uiProps
}: SocialFeedProps) {
	const feed = useSocialFeed({
		channel,
		query,
		limit,
		apiUrl,
		autoFetch,
	})

	return (
		<SocialFeedUI
			posts={feed.posts}
			isLoading={feed.isLoading}
			isLoadingMore={feed.isLoadingMore}
			error={feed.error}
			hasMore={feed.hasMore}
			onLoadMore={feed.loadMore}
			onRefresh={feed.refresh}
			{...uiProps}
		/>
	)
}
