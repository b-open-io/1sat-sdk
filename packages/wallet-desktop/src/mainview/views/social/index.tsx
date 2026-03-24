import {
	FollowButton,
	type FollowResult,
} from '@/components/blocks/follow-button'
import { LikeButton, type LikeResult } from '@/components/blocks/like-button'
import { PostButton, type PostResult } from '@/components/blocks/post-button'
import { SocialFeed, type SocialPost } from '@/components/blocks/social-feed'
import { useCallback } from 'react'
import { rpc } from '../../rpc'

export interface SocialViewProps {
	onNavigate?: (url: string) => void
}

export function SocialView({ onNavigate }: SocialViewProps) {
	const handlePost = useCallback(
		async (content: string): Promise<PostResult> => {
			const result = await rpc.request.createSocialPost({ content })
			if (result.error) {
				throw new Error(result.error)
			}
			return { txid: result.txid ?? '' }
		},
		[],
	)

	const handleLike = useCallback(async (txid: string): Promise<LikeResult> => {
		const result = await rpc.request.createSocialPost({
			content: `liked:${txid}`,
		})
		if (result.error) {
			throw new Error(result.error)
		}
		return { txid: result.txid ?? '' }
	}, [])

	const handleFollow = useCallback(
		async (bapId: string): Promise<FollowResult> => {
			const result = await rpc.request.createSocialPost({
				content: `follow:${bapId}`,
			})
			if (result.error) {
				throw new Error(result.error)
			}
			return { txid: result.txid ?? '' }
		},
		[],
	)

	const handlePostClick = useCallback((_post: SocialPost) => {
		// V1: no-op — post detail view not yet implemented
	}, [])

	const handleAuthorClick = useCallback(
		(post: SocialPost) => {
			const bapId = post.signers?.[0]?.bapId
			if (bapId) {
				onNavigate?.(`1sat://identity/profile?bapId=${bapId}`)
			}
		},
		[onNavigate],
	)

	return (
		<div className="mx-auto w-full py-8" style={{ maxWidth: 800 }}>
			{/* Header row */}
			<div className="flex items-center justify-between px-6 mb-6">
				<h1
					className="text-foreground font-semibold"
					style={{
						fontFamily: 'var(--font-sans)',
						fontSize: 20,
						lineHeight: 1,
					}}
				>
					Social
				</h1>
				<PostButton
					onPost={handlePost}
					onPosted={(result) => {
						console.log('Posted:', result.txid)
					}}
				/>
			</div>

			{/* Feed */}
			<div className="border-t border-border">
				<SocialFeed
					onPostClick={handlePostClick}
					onAuthorClick={handleAuthorClick}
					renderLikeButton={(post) => (
						<LikeButton
							txid={post.txid}
							count={post.likes ?? 0}
							variant="text"
							onLike={handleLike}
						/>
					)}
					renderFollowButton={(post) => {
						const bapId = post.signers?.[0]?.bapId
						if (!bapId) return null
						return <FollowButton bapId={bapId} onFollow={handleFollow} />
					}}
				/>
			</div>
		</div>
	)
}
