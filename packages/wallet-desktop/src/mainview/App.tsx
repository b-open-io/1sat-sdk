import { Button } from '@/components/ui/button'
import { useEffect, useRef, useState } from 'react'
import { BigBlocksProvider } from '@/components/blocks/bigblocks-provider'
import { PermissionApproval } from '@/components/blocks/permission-approval'
import { onPermissionRequest, rpc } from './rpc'
import { BrowserLayout } from './components/layout/browser-layout'
import { useWallet } from './hooks/use-wallet'
import { AccountPicker } from './views/account-picker'
import { CreateWallet } from './views/onboarding/create-wallet'
import { ImportWallet } from './views/onboarding/import-wallet'
import { SetupWizard } from './views/onboarding/setup-wizard'
import { UnlockWallet } from './views/onboarding/unlock-wallet'

type OnboardingChoice = 'none' | 'create' | 'import'

function LoadingScreen() {
	const [elapsed, setElapsed] = useState(0)

	useEffect(() => {
		const t = setInterval(() => setElapsed((e) => e + 1), 1000)
		return () => clearInterval(t)
	}, [])

	return (
		<div className="min-h-screen flex items-center justify-center">
			<div className="text-center max-w-sm">
				<div className="text-lg font-bold text-foreground mb-2">
					1Sat
				</div>
				<div className="text-sm text-muted-foreground font-mono">
					{elapsed < 10
						? 'Initializing...'
						: elapsed < 30
							? 'Still loading — this may take a moment...'
							: 'Taking longer than expected. The backend may not be responding.'}
				</div>
				{elapsed >= 30 && (
					<div className="mt-4 text-xs text-muted-foreground/60 font-mono">
						Check ~/.1sat-wallet/logs/ for diagnostics
					</div>
				)}
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
					1Sat
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
	const { status, activeAccount } = useWallet()
	const [onboardingChoice, setOnboardingChoice] =
		useState<OnboardingChoice>('none')

	// Per-account setup tracking
	const setupKey = activeAccount
		? `1sat-setup-complete-${activeAccount.id}`
		: '1sat-setup-complete'

	const [setupComplete, setSetupComplete] = useState(
		() => localStorage.getItem(setupKey) === 'true',
	)

	const prevStatus = useRef(status)
	useEffect(() => {
		// Returning users who go locked -> unlocked already have a wallet
		if (prevStatus.current === 'locked' && status === 'unlocked') {
			localStorage.setItem(setupKey, 'true')
			setSetupComplete(true)
		}
		prevStatus.current = status
	}, [status, setupKey])

	// Re-check setup complete when active account changes
	useEffect(() => {
		setSetupComplete(localStorage.getItem(setupKey) === 'true')
	}, [setupKey])

	if (status === 'initializing') {
		return <LoadingScreen />
	}

	if (status === 'account-selection') {
		return <AccountPicker />
	}

	if (status === 'locked') {
		return <UnlockWallet />
	}

	if (status === 'unlocked') {
		if (!setupComplete) {
			return (
				<SetupWizard
					onComplete={() => {
						localStorage.setItem(setupKey, 'true')
						setSetupComplete(true)
					}}
				/>
			)
		}
		return (
			<BigBlocksProvider>
				<BrowserLayout />
				<PermissionApproval
					subscribe={onPermissionRequest}
					resolve={(params) => rpc.request.resolvePermission(params)}
				/>
			</BigBlocksProvider>
		)
	}

	const cancelOnboarding = () => setOnboardingChoice('none')

	// status === "no-wallet"
	if (onboardingChoice === 'create') {
		return <CreateWallet onCancel={cancelOnboarding} />
	}

	if (onboardingChoice === 'import') {
		return <ImportWallet onCancel={cancelOnboarding} />
	}

	return <OnboardingChoice onChoose={setOnboardingChoice} />
}

export default App
