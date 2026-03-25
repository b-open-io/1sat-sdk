import { MnemonicFlow } from '@/components/blocks/mnemonic-flow'
import { useCallback, useState } from 'react'
import { useWallet } from '../../hooks/use-wallet'

export function ImportWallet({ onCancel }: { onCancel: () => void }) {
	const { importAccount } = useWallet()
	const [error, setError] = useState<string | null>(null)
	const [loading, setLoading] = useState(false)

	const handleComplete = useCallback(
		async (words: string[]) => {
			setError(null)
			setLoading(true)
			try {
				const result = await importAccount(words.join(' '))
				if (!result.success) {
					setError(result.error ?? 'Failed to import wallet')
				}
			} catch (err) {
				setError(String(err))
			} finally {
				setLoading(false)
			}
		},
		[importAccount],
	)

	return (
		<div className="max-w-lg mx-auto p-6 min-h-screen flex flex-col justify-center">
			<h1 className="text-2xl font-bold text-foreground mb-1">Import Wallet</h1>
			<p className="text-sm text-muted-foreground mb-6">
				Enter your 12-word recovery phrase to restore your wallet.
			</p>

			<MnemonicFlow
				mode="import"
				onComplete={handleComplete}
				onCancel={onCancel}
				isLoading={loading}
				error={error}
			/>
		</div>
	)
}
