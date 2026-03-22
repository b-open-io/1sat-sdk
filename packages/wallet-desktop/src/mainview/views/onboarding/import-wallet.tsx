import { useCallback, useState } from 'react'
import { MnemonicFlow } from '@/components/blocks/mnemonic-flow'
import { useWallet } from '../../hooks/use-wallet'

export function ImportWallet() {
	const { importWallet } = useWallet()
	const [error, setError] = useState<string | null>(null)
	const [loading, setLoading] = useState(false)

	const handleComplete = useCallback(
		async (words: string[]) => {
			setError(null)
			setLoading(true)
			try {
				const result = await importWallet(words.join(' '), '')
				if (!result.success) {
					setError(result.error ?? 'Failed to import wallet')
				}
			} catch (err) {
				setError(String(err))
			} finally {
				setLoading(false)
			}
		},
		[importWallet],
	)

	return (
		<div className="max-w-lg mx-auto p-6">
			<h1 className="text-2xl font-bold text-foreground mb-1">
				Import Wallet
			</h1>
			<p className="text-sm text-muted-foreground mb-6">
				Enter your 12-word recovery phrase to restore your wallet.
			</p>

			<MnemonicFlow
				mode="import"
				onComplete={handleComplete}
				isLoading={loading}
				error={error}
			/>
		</div>
	)
}
