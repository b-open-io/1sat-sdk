import {
	UnlockWallet as UnlockWalletBlock,
	type UnlockWalletResult,
} from '@/components/blocks/unlock-wallet'
import { useCallback } from 'react'
import { useWallet } from '../../hooks/use-wallet'

export function UnlockWallet() {
	const { unlockWallet } = useWallet()

	const handleUnlock = useCallback(
		async (passphrase?: string): Promise<UnlockWalletResult> => {
			const result = await unlockWallet(passphrase ?? '')
			return {
				success: result.success,
				error: result.error,
			}
		},
		[unlockWallet],
	)

	return (
		<div className="max-w-sm mx-auto flex flex-col items-center justify-center min-h-screen">
			<UnlockWalletBlock
				platform="macos"
				appName="1Sat Wallet"
				onUnlock={handleUnlock}
			/>
		</div>
	)
}
