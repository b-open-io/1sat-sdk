import {
	UnlockWallet as UnlockWalletBlock,
	type UnlockWalletResult,
} from '@/components/blocks/unlock-wallet'
import { useCallback } from 'react'
import { useWallet } from '../../hooks/use-wallet'
import { rpc } from '../../rpc'

export function UnlockWallet() {
	const { accounts } = useWallet()

	const handleUnlock = useCallback(
		async (_passphrase?: string): Promise<UnlockWalletResult> => {
			// When the unlock screen shows, there's exactly one account
			// and the picker is disabled — select it directly.
			const account = accounts[0]
			if (!account) {
				return { success: false, error: 'No account found' }
			}
			const result = await rpc.request.selectAccount({ accountId: account.id })
			return {
				success: result.success,
				error: result.error,
			}
		},
		[accounts],
	)

	return (
		<div className="max-w-sm mx-auto flex flex-col items-center justify-center min-h-screen">
			<UnlockWalletBlock
				platform="macos"
				appName="1Sat"
				onUnlock={handleUnlock}
			/>
		</div>
	)
}
