import { useCallback, useEffect, useState } from 'react'
import { MnemonicFlow } from '@/components/blocks/mnemonic-flow'
import { useWallet } from '../../hooks/use-wallet'

export function CreateWallet({ onCancel }: { onCancel: () => void }) {
	const { createAccount, generateMnemonic } = useWallet()
	const [words, setWords] = useState<string[] | null>(null)
	const [error, setError] = useState<string | null>(null)
	const [loading, setLoading] = useState(false)

	useEffect(() => {
		generateMnemonic().then(
			(m) => setWords(m.split(' ')),
			(err) => setError(`Failed to generate mnemonic: ${err}`),
		)
	}, [generateMnemonic])

	const handleComplete = useCallback(
		async (completedWords: string[]) => {
			setError(null)
			setLoading(true)
			try {
				const result = await createAccount(completedWords.join(' '))
				if (!result.success) {
					setError(result.error ?? 'Failed to create wallet')
				}
			} catch (err) {
				setError(String(err))
			} finally {
				setLoading(false)
			}
		},
		[createAccount],
	)

	if (!words) {
		return (
			<div className="max-w-lg mx-auto p-6 min-h-screen flex flex-col justify-center">
				<h1 className="text-2xl font-bold text-foreground mb-1">
					Create Wallet
				</h1>
				<p className="text-sm text-muted-foreground mb-6">
					{error ?? 'Generating recovery phrase...'}
				</p>
			</div>
		)
	}

	return (
		<div className="max-w-lg mx-auto p-6 min-h-screen flex flex-col justify-center">
			<h1 className="text-2xl font-bold text-foreground mb-1">Create Wallet</h1>
			<p className="text-sm text-muted-foreground mb-6">
				Write down your recovery phrase and store it safely.
			</p>

			<MnemonicFlow
				mode="create"
				words={words}
				onComplete={handleComplete}
				onCancel={onCancel}
				isLoading={loading}
				error={error}
			/>
		</div>
	)
}
