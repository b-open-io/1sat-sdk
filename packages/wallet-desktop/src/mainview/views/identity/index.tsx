import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { ProfileCard } from '@/components/blocks/profile-card'
import { FollowButton, type FollowResult } from '@/components/blocks/follow-button'
import { IdentitySelector, type IdentityEntry } from '@/components/blocks/identity-selector'
import { rpc } from '../../rpc'

export function IdentityView() {
	const [bapId, setBapId] = useState<string | null>(null)
	const [loading, setLoading] = useState(true)
	const [publishing, setPublishing] = useState(false)
	const [error, setError] = useState<string | null>(null)

	const fetchIdentity = useCallback(async () => {
		try {
			const result = await rpc.request.getIdentity()
			setBapId(result.bapId)
			setError(null)
		} catch (err) {
			setError(
				err instanceof Error
					? err.message
					: 'Failed to load identity',
			)
		} finally {
			setLoading(false)
		}
	}, [])

	useEffect(() => {
		fetchIdentity()
	}, [fetchIdentity])

	const handlePublish = useCallback(async () => {
		setPublishing(true)
		setError(null)
		try {
			const result = await rpc.request.publishIdentity()
			if (result.error) {
				setError(result.error)
			} else if (result.bapId) {
				setBapId(result.bapId)
			}
		} catch (err) {
			setError(
				err instanceof Error
					? err.message
					: 'Failed to publish identity',
			)
		} finally {
			setPublishing(false)
		}
	}, [])

	if (loading) {
		return (
			<div className="p-6">
				<div className="text-xs font-mono uppercase tracking-wider text-muted-foreground mb-4">
					Identity
				</div>
				<p className="text-sm text-muted-foreground">
					Loading identity...
				</p>
			</div>
		)
	}

	// Build identity entries for the selector
	const identities: IdentityEntry[] = bapId
		? [
				{
					bapId,
					name: bapId.slice(0, 12),
					currentAddress: '',
					imageUrl: null,
				},
			]
		: []

	return (
		<div className="p-6 max-w-2xl space-y-6">
			<div className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
				Identity
			</div>

			{error && (
				<div className="p-3 border border-destructive text-destructive text-sm font-mono">
					{error}
				</div>
			)}

			{!bapId ? (
				<div className="space-y-3">
					<p className="text-sm text-muted-foreground">
						No BAP identity published yet. Publish your identity to
						use social features and identity binding.
					</p>
					<Button
						onClick={handlePublish}
						disabled={publishing}
					>
						{publishing
							? 'Publishing...'
							: 'Publish Identity'}
					</Button>
				</div>
			) : (
				<div className="space-y-6">
					<ProfileCard
						bapId={bapId}
						renderAction={(id) => (
							<FollowButton
								bapId={id}
								isFollowing={false}
								onFollow={async (bapId): Promise<FollowResult> => {
									const result = await rpc.request.createSocialPost({
										content: `follow:${bapId}`,
									})
									if (result.error) {
										throw new Error(result.error)
									}
									return { txid: result.txid ?? '' }
								}}
								disabled
							/>
						)}
					/>
					<div>
						<h3 className="text-sm font-medium text-foreground mb-2">
							Your Identities
						</h3>
						<IdentitySelector
							identities={identities}
							activeBapId={bapId}
							onSelect={(id) => console.log('Selected identity:', id)}
							showAddIdentity={false}
						/>
					</div>
				</div>
			)}
		</div>
	)
}
