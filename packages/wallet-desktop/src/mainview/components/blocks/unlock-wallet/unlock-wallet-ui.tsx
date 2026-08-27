import {
	AlertCircle,
	CheckCircle2,
	Fingerprint,
	KeyRound,
	Loader2,
	Lock,
	ShieldCheck,
} from 'lucide-react'
import { useCallback, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
	Card,
	CardContent,
	CardDescription,
	CardFooter,
	CardHeader,
	CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import type { UnlockPlatform, UnlockWalletResult } from './use-unlock-wallet'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UnlockWalletUiProps {
	/** Platform determines which unlock methods are shown */
	platform: UnlockPlatform
	/** Application name displayed in the UI */
	appName: string
	/** Whether an unlock is in progress */
	isLoading: boolean
	/** Current error state */
	error: Error | null
	/** Whether the wallet is already unlocked */
	isUnlocked: boolean
	/** Number of failed attempts */
	failedAttempts: number
	/** Called when the user attempts to unlock */
	onSubmit: (passphrase?: string) => Promise<UnlockWalletResult>
	/** Reset error state */
	onReset: () => void
	/** Optional CSS class */
	className?: string
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function UnlockWalletUi({
	platform,
	appName,
	isLoading,
	error,
	isUnlocked,
	failedAttempts,
	onSubmit,
	onReset,
	className,
}: UnlockWalletUiProps) {
	const [passphrase, setPassphrase] = useState('')
	const [showPassphrase, setShowPassphrase] = useState(false)

	const isMac = platform === 'macos'

	const handleBiometricUnlock = useCallback(async () => {
		await onSubmit(undefined)
	}, [onSubmit])

	const handlePassphraseUnlock = useCallback(async () => {
		if (!passphrase.trim()) return
		await onSubmit(passphrase)
		setPassphrase('')
	}, [onSubmit, passphrase])

	const handleKeyDown = useCallback(
		(e: React.KeyboardEvent<HTMLInputElement>) => {
			if (e.key === 'Enter') {
				e.preventDefault()
				void handlePassphraseUnlock()
			}
		},
		[handlePassphraseUnlock],
	)

	const handleShowPassphrase = useCallback(() => {
		setShowPassphrase(true)
		onReset()
	}, [onReset])

	// Unlocked state
	if (isUnlocked) {
		return (
			<Card className={cn('w-full max-w-sm', className)}>
				<CardContent className="flex flex-col items-center gap-4 pt-6">
					<div className="flex size-16 items-center justify-center rounded-full bg-primary/10">
						<ShieldCheck className="size-8 text-primary" aria-hidden="true" />
					</div>
					<div className="flex flex-col items-center gap-1 text-center">
						<p className="text-lg font-semibold">Wallet Unlocked</p>
						<p className="text-sm text-muted-foreground">
							{appName} is ready to use
						</p>
					</div>
					<Badge variant="outline" className="gap-1.5">
						<CheckCircle2 className="size-3" aria-hidden="true" />
						Authenticated
					</Badge>
				</CardContent>
			</Card>
		)
	}

	// macOS biometric-first layout
	if (isMac && !showPassphrase) {
		return (
			<Card className={cn('w-full max-w-sm', className)}>
				<CardHeader className="items-center text-center">
					<div className="mb-2 flex size-16 items-center justify-center rounded-full bg-muted">
						<Lock className="size-8 text-muted-foreground" aria-hidden="true" />
					</div>
					<CardTitle>{appName}</CardTitle>
					<CardDescription>Use Touch ID to unlock your wallet</CardDescription>
				</CardHeader>

				<CardContent className="flex flex-col items-center gap-4">
					<Button
						size="lg"
						className="w-full gap-2"
						onClick={() => {
							void handleBiometricUnlock()
						}}
						disabled={isLoading}
						aria-busy={isLoading}
					>
						{isLoading ? (
							<>
								<Loader2
									className="animate-spin"
									data-icon="inline-start"
									aria-hidden="true"
								/>
								Authenticating...
							</>
						) : (
							<>
								<Fingerprint data-icon="inline-start" aria-hidden="true" />
								Unlock with Touch ID
							</>
						)}
					</Button>

					{/* Error */}
					{error && (
						<div className="flex w-full items-start gap-3 rounded-md border border-destructive/20 bg-destructive/5 p-3">
							<AlertCircle className="mt-0.5 size-4 flex-shrink-0 text-destructive" />
							<div className="flex flex-col gap-1">
								<p className="text-sm font-medium">Unlock failed</p>
								<p className="text-xs text-muted-foreground">{error.message}</p>
							</div>
						</div>
					)}

					{failedAttempts > 0 && (
						<Badge variant="secondary" className="text-xs">
							{failedAttempts} failed{' '}
							{failedAttempts === 1 ? 'attempt' : 'attempts'}
						</Badge>
					)}
				</CardContent>

				<CardFooter className="justify-center">
					<Button
						variant="link"
						size="sm"
						className="text-xs text-muted-foreground"
						onClick={handleShowPassphrase}
					>
						Use passphrase instead
					</Button>
				</CardFooter>
			</Card>
		)
	}

	// Passphrase layout (default for "other" or fallback from macOS)
	return (
		<Card className={cn('w-full max-w-sm', className)}>
			<CardHeader className="items-center text-center">
				<div className="mb-2 flex size-16 items-center justify-center rounded-full bg-muted">
					<Lock className="size-8 text-muted-foreground" aria-hidden="true" />
				</div>
				<CardTitle>{appName}</CardTitle>
				<CardDescription>
					Enter your passphrase to unlock your wallet
				</CardDescription>
			</CardHeader>

			<CardContent className="flex flex-col gap-4">
				<div className="flex flex-col gap-2">
					<Label htmlFor="unlock-passphrase">Passphrase</Label>
					<Input
						id="unlock-passphrase"
						type="password"
						placeholder="Enter your passphrase"
						value={passphrase}
						onChange={(e) => setPassphrase(e.target.value)}
						onKeyDown={handleKeyDown}
						disabled={isLoading}
						autoComplete="current-password"
						autoFocus
					/>
				</div>

				{/* Error */}
				{error && (
					<div className="flex items-start gap-3 rounded-md border border-destructive/20 bg-destructive/5 p-3">
						<AlertCircle className="mt-0.5 size-4 flex-shrink-0 text-destructive" />
						<div className="flex flex-col gap-1">
							<p className="text-sm font-medium">Unlock failed</p>
							<p className="text-xs text-muted-foreground">{error.message}</p>
						</div>
					</div>
				)}

				{failedAttempts > 0 && (
					<div className="flex justify-center">
						<Badge variant="secondary" className="text-xs">
							{failedAttempts} failed{' '}
							{failedAttempts === 1 ? 'attempt' : 'attempts'}
						</Badge>
					</div>
				)}
			</CardContent>

			<CardFooter className="flex flex-col gap-2">
				<Button
					className="w-full gap-2"
					onClick={() => {
						void handlePassphraseUnlock()
					}}
					disabled={isLoading || !passphrase.trim()}
					aria-busy={isLoading}
				>
					{isLoading ? (
						<>
							<Loader2
								className="animate-spin"
								data-icon="inline-start"
								aria-hidden="true"
							/>
							Unlocking...
						</>
					) : (
						<>
							<KeyRound data-icon="inline-start" aria-hidden="true" />
							Unlock Wallet
						</>
					)}
				</Button>

				{isMac && (
					<Button
						variant="link"
						size="sm"
						className="text-xs text-muted-foreground"
						onClick={() => {
							setShowPassphrase(false)
							onReset()
						}}
					>
						Use Touch ID instead
					</Button>
				)}
			</CardFooter>
		</Card>
	)
}
