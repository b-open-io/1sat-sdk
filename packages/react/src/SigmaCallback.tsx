'use client'

import { completeSigmaOAuth, connectSigmaWallet } from '@1sat/connect'
import { type ReactNode, useEffect, useState } from 'react'
import { useWallet } from './wallet-context'

export interface SigmaCallbackProps {
	/** Where to redirect after successful auth (default: '/') */
	redirectTo?: string
	/** Called after successful auth instead of hard redirect. Use for SPA navigation. */
	onComplete?: () => void
	/** Custom loading content */
	loadingContent?: ReactNode
	/** Custom error render */
	renderError?: (error: string, goBack: () => void) => ReactNode
}

/**
 * Sigma OAuth callback page component.
 *
 * Completes the full sign-in flow:
 * 1. Exchange OAuth code for identity (bapId, pubkey)
 * 2. Create CWI iframe and wait for wallet authentication
 * 3. Store connection for WalletProvider
 * 4. Redirect to target page
 */
export function SigmaCallback({
	redirectTo = '/',
	onComplete,
	loadingContent,
	renderError,
}: SigmaCallbackProps) {
	const { applyResult } = useWallet()
	const [error, setError] = useState<string | null>(null)
	const [status, setStatus] = useState<string>('Completing authentication...')

	useEffect(() => {
		const searchParams = new URLSearchParams(window.location.search)

		async function completeSignIn() {
			const oauthResult = await completeSigmaOAuth(searchParams)

			setStatus('Connecting wallet...')

			const walletResult = await connectSigmaWallet(oauthResult.bapId)
			applyResult(walletResult)

			if (onComplete) {
				onComplete()
			} else {
				window.location.href = redirectTo
			}
		}

		completeSignIn().catch((err) => {
			console.error('Sigma sign-in error:', err)
			const msg =
				err instanceof Error
					? err.message
					: typeof err === 'object' && err !== null && 'message' in err
						? String(err.message)
						: 'Authentication failed'
			setError(msg)
		})
	}, [redirectTo, applyResult, onComplete])

	if (error) {
		if (renderError) {
			return (
				<>
					{renderError(error, () => {
						window.location.href = '/'
					})}
				</>
			)
		}

		return (
			<div
				style={{
					display: 'flex',
					minHeight: '100vh',
					alignItems: 'center',
					justifyContent: 'center',
					padding: '1rem',
				}}
			>
				<div style={{ maxWidth: '28rem', width: '100%' }}>
					<h2
						style={{
							fontSize: '1.125rem',
							fontWeight: 600,
							marginBottom: '0.5rem',
						}}
					>
						Authentication Error
					</h2>
					<p style={{ fontSize: '0.875rem', color: '#666' }}>{error}</p>
					<button
						type="button"
						onClick={() => {
							window.location.href = '/'
						}}
						style={{
							marginTop: '1rem',
							padding: '0.5rem 1rem',
							fontSize: '0.875rem',
							cursor: 'pointer',
						}}
					>
						Go Back
					</button>
				</div>
			</div>
		)
	}

	if (loadingContent) {
		return <>{loadingContent}</>
	}

	return (
		<div
			style={{
				display: 'flex',
				minHeight: '100vh',
				alignItems: 'center',
				justifyContent: 'center',
			}}
		>
			<p style={{ color: '#666' }}>{status}</p>
		</div>
	)
}
