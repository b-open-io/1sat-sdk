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
		<div
			className="mx-auto w-full py-8"
			style={{ maxWidth: 800 }}
		>
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
				/>
			</div>
		</div>
	)
}
