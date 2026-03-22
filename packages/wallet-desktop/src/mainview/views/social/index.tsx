import { useCallback } from 'react'
import { SocialFeed, type SocialPost } from '@/components/blocks/social-feed'
import { PostButton, type PostResult } from '@/components/blocks/post-button'
import { LikeButton, type LikeResult } from '@/components/blocks/like-button'
import { rpc } from '../../rpc'

export function SocialView() {
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

	const handleLike = useCallback(
		async (txid: string): Promise<LikeResult> => {
			// Like is a social action - for now we create a social post referencing the txid
			// A dedicated like RPC could be added later
			const result = await rpc.request.createSocialPost({
				content: `liked:${txid}`,
			})
			if (result.error) {
				throw new Error(result.error)
			}
			return { txid: result.txid ?? '' }
		},
		[],
	)

	const handlePostClick = useCallback((post: SocialPost) => {
		console.log('Post clicked:', post.txid)
	}, [])

	const handleAuthorClick = useCallback((post: SocialPost) => {
		console.log('Author clicked:', post.signers?.[0]?.bapId)
	}, [])

	return (
		<div className="p-6 max-w-2xl">
			<div className="flex items-center justify-between mb-4">
				<div className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
					Social Feed
				</div>
				<PostButton
					onPost={handlePost}
					onPosted={(result) => {
						console.log('Posted:', result.txid)
					}}
				/>
			</div>
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
			/>
		</div>
	)
}
