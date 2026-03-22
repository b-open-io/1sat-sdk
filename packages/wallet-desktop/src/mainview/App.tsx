import { Button } from '@/components/ui/button'
import { useState } from 'react'
import { DesktopLayout } from './components/layout/desktop-layout'
import { useWallet } from './hooks/use-wallet'
import { CreateWallet } from './views/onboarding/create-wallet'
import { ImportWallet } from './views/onboarding/import-wallet'
import { UnlockWallet } from './views/onboarding/unlock-wallet'

type OnboardingChoice = 'none' | 'create' | 'import'

function LoadingScreen() {
	return (
		<div className="min-h-screen flex items-center justify-center">
			<div className="text-center">
				<div className="text-lg font-bold text-foreground mb-2">
					1Sat Wallet
				</div>
				<div className="text-sm text-muted-foreground font-mono">
					Initializing...
				</div>
			</div>
		</div>
	)
}

function OnboardingChoice({
	onChoose,
}: { onChoose: (choice: OnboardingChoice) => void }) {
	return (
		<div className="min-h-screen flex items-center justify-center">
			<div className="max-w-sm w-full p-6">
				<h1 className="text-2xl font-bold text-foreground mb-1 text-center">
					1Sat Wallet
				</h1>
				<p className="text-sm text-muted-foreground mb-8 text-center">
					Get started with your BSV wallet
				</p>

				<div className="space-y-3">
					<Button
						className="w-full"
						size="lg"
						onClick={() => onChoose('create')}
					>
						Create New Wallet
					</Button>
					<Button
						variant="secondary"
						className="w-full"
						size="lg"
						onClick={() => onChoose('import')}
					>
						Import Existing Wallet
					</Button>
				</div>
			</div>
		</div>
	)
}

function App() {
	const { status } = useWallet()
	const [onboardingChoice, setOnboardingChoice] =
		useState<OnboardingChoice>('none')

	if (status === 'initializing') {
		return <LoadingScreen />
	}

	if (status === 'locked') {
		return <UnlockWallet />
	}

	if (status === 'unlocked') {
		return <DesktopLayout />
	}

	// status === "no-wallet"
	if (onboardingChoice === 'create') {
		return <CreateWallet />
	}

	if (onboardingChoice === 'import') {
		return <ImportWallet />
	}

	return <OnboardingChoice onChoose={setOnboardingChoice} />
}

export default App
