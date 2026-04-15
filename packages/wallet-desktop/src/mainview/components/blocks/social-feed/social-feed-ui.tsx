import { Button } from '@/components/ui/button'
import { Empty } from '@/components/ui/empty'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { AlertCircle, Loader2, MessageSquare } from 'lucide-react'
import { useCallback, useEffect, useRef } from 'react'
import { PostCardUI, type PostCardUIProps } from './post-card-ui'
import type { SocialPost } from './use-social-feed'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SocialFeedUIProps {
	/** Array of posts to display */
	posts: SocialPost[]
	/** Whether the initial fetch is in progress */
	isLoading: boolean
	/** Whether a "load more" request is in progress */
	isLoadingMore: boolean
	/** Error from the most recent fetch */
	error: Error | null
	/** Whether more posts are available to load */
	hasMore: boolean
	/** Fetch the next page of posts */
	onLoadMore: () => void
	/** Re-fetch the feed from the beginning */
	onRefresh: () => void
	/** Optional CSS classes for the outer container */
	className?: string
	/** Called when a post card is clicked */
	onPostClick?: (post: SocialPost) => void
	/** Called when an author is clicked */
	onAuthorClick?: (post: SocialPost) => void
	/** Called when the reply button is clicked */
	onReplyClick?: (post: SocialPost) => void
	/** Whether to use IntersectionObserver for infinite scroll (default: true) */
	infiniteScroll?: boolean
	/** Render function for a custom like button per post */
	renderLikeButton?: (post: SocialPost) => React.ReactNode
	/** Render function for a custom follow button per post */
	renderFollowButton?: (post: SocialPost) => React.ReactNode
	/** Render function for custom post card content */
	renderPostCard?: (
		post: SocialPost,
		defaultProps: PostCardUIProps,
	) => React.ReactNode
}

// ---------------------------------------------------------------------------
// Skeleton loader
// ---------------------------------------------------------------------------

function PostCardSkeleton() {
	return (
		<div className="flex gap-3 px-4 py-3" data-testid="post-card-skeleton">
			<Skeleton className="size-8 rounded-full shrink-0" />
			<div className="flex flex-1 flex-col gap-2">
				<div className="flex items-center gap-2">
					<Skeleton className="h-4 w-24" />
					<Skeleton className="h-3 w-12 ml-auto" />
				</div>
				<Skeleton className="h-4 w-full" />
				<Skeleton className="h-4 w-3/4" />
				<div className="flex gap-3 pt-1">
					<Skeleton className="size-5 rounded-full" />
					<Skeleton className="size-5 rounded-full" />
				</div>
			</div>
		</div>
	)
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

function EmptyState({ onRefresh }: { onRefresh: () => void }) {
	return (
		<Empty
			icon={MessageSquare}
			title="No posts yet"
			description="Be the first to post something on-chain."
			action={{ label: 'Refresh', onClick: onRefresh }}
			data-testid="social-feed-empty"
		/>
	)
}

// ---------------------------------------------------------------------------
// Error state
// ---------------------------------------------------------------------------

function ErrorState({
	error,
	onRetry,
}: {
	error: Error
	onRetry: () => void
}) {
	return (
		<div
			className="flex flex-col items-center justify-center py-12 px-4 text-center"
			role="alert"
			data-testid="social-feed-error"
		>
			<div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-destructive/10">
				<AlertCircle className="size-6 text-destructive" />
			</div>
			<p className="text-sm font-medium text-foreground">
				Failed to load posts
			</p>
			<p className="mt-1 text-sm text-muted-foreground max-w-sm">
				{error.message}
			</p>
			<Button variant="outline" size="sm" className="mt-4" onClick={onRetry}>
				Try again
			</Button>
		</div>
	)
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SocialFeedUI({
	posts,
	isLoading,
	isLoadingMore,
	error,
	hasMore,
	onLoadMore,
	onRefresh,
	className,
	onPostClick,
	onAuthorClick,
	onReplyClick,
	infiniteScroll = true,
	renderLikeButton,
	renderFollowButton,
	renderPostCard,
}: SocialFeedUIProps) {
	// Infinite scroll via IntersectionObserver
	const sentinelRef = useRef<HTMLDivElement>(null)

	const handleIntersect = useCallback(
		(entries: IntersectionObserverEntry[]) => {
			const entry = entries[0]
			if (entry?.isIntersecting && hasMore && !isLoading && !isLoadingMore) {
				onLoadMore()
			}
		},
		[hasMore, isLoading, isLoadingMore, onLoadMore],
	)

	useEffect(() => {
		if (!infiniteScroll) return
		const sentinel = sentinelRef.current
		if (!sentinel) return

		const observer = new IntersectionObserver(handleIntersect, {
			rootMargin: '200px',
		})
		observer.observe(sentinel)
		return () => observer.disconnect()
	}, [infiniteScroll, handleIntersect])

	// Initial loading state
	if (isLoading && posts.length === 0) {
		return (
			<div
				className={cn('divide-y divide-border', className)}
				data-testid="social-feed"
			>
				<PostCardSkeleton />
				<PostCardSkeleton />
				<PostCardSkeleton />
			</div>
		)
	}

	// Error state (no posts loaded yet)
	if (error && posts.length === 0) {
		return (
			<div className={className} data-testid="social-feed">
				<ErrorState error={error} onRetry={onRefresh} />
			</div>
		)
	}

	// Empty state
	if (!isLoading && posts.length === 0) {
		return (
			<div className={className} data-testid="social-feed">
				<EmptyState onRefresh={onRefresh} />
			</div>
		)
	}

	return (
		<div className={cn('relative', className)} data-testid="social-feed">
			{/* Post list */}
			<div className="divide-y divide-border">
				{posts.map((post) => {
					const defaultProps: PostCardUIProps = {
						post,
						onPostClick,
						onAuthorClick,
						onReplyClick,
						likeButtonSlot: renderLikeButton?.(post),
						followButtonSlot: renderFollowButton?.(post),
					}

					return renderPostCard ? (
						<div key={post.txid}>{renderPostCard(post, defaultProps)}</div>
					) : (
						<PostCardUI key={post.txid} {...defaultProps} />
					)
				})}
			</div>

			{/* Load more area */}
			<div className="py-4">
				{isLoadingMore && (
					<div className="flex items-center justify-center gap-2 py-3 text-sm text-muted-foreground">
						<Loader2 className="size-4 animate-spin" />
						Loading more posts...
					</div>
				)}

				{/* Error loading more (posts already visible) */}
				{error && posts.length > 0 && (
					<div className="flex items-center justify-center gap-2 py-3">
						<p className="text-sm text-destructive">{error.message}</p>
						<Button variant="ghost" size="sm" onClick={onLoadMore}>
							Retry
						</Button>
					</div>
				)}

				{/* Manual load more button (when infinite scroll is disabled) */}
				{!infiniteScroll && hasMore && !isLoadingMore && !error && (
					<div className="flex justify-center">
						<Button variant="outline" size="sm" onClick={onLoadMore}>
							Load more
						</Button>
					</div>
				)}

				{/* End of feed */}
				{!hasMore && posts.length > 0 && (
					<div className="flex items-center justify-center gap-3 py-2">
						<Separator className="flex-1 max-w-16" />
						<p className="text-xs text-muted-foreground">End of feed</p>
						<Separator className="flex-1 max-w-16" />
					</div>
				)}

				{/* Infinite scroll sentinel */}
				{infiniteScroll && hasMore && (
					<div ref={sentinelRef} className="h-1" aria-hidden="true" />
				)}
			</div>
		</div>
	)
}
