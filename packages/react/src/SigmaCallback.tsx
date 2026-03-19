'use client'

import { completeSigmaOAuth } from '@1sat/connect'
import { type ReactNode, useEffect, useState } from 'react'

const STORAGE_KEY = 'onesat_wallet_provider'

export interface SigmaCallbackProps {
	/** Where to redirect after successful auth (default: '/') */
	redirectTo?: string
	/** Custom loading content */
	loadingContent?: ReactNode
	/** Custom error render */
	renderError?: (error: string, goBack: () => void) => ReactNode
}

/**
 * Generic Sigma OAuth callback page component.
 *
 * Uses the better-auth-plugin's handleCallback() to complete the OAuth flow.
 * Stores the result in WalletProvider's localStorage key for reconnection.
 *
 * ```tsx
 * // app/auth/sigma/callback/page.tsx
 * import { SigmaCallback } from '@1sat/react'
 * export default function Page() {
 *   return <SigmaCallback redirectTo="/dashboard" />
 * }
 * ```
 */
export function SigmaCallback({
	redirectTo = '/',
	loadingContent,
	renderError,
}: SigmaCallbackProps) {
	const [error, setError] = useState<string | null>(null)

	useEffect(() => {
		const searchParams = new URLSearchParams(window.location.search)

		completeSigmaOAuth(searchParams)
			.then((result) => {
				localStorage.setItem(
					STORAGE_KEY,
					JSON.stringify({
						providerType: 'sigma',
						identityKey: result.pubkey,
						bapId: result.bapId,
						user: result.user,
						accessToken: result.accessToken,
					}),
				)

				window.location.href = redirectTo
			})
			.catch((err) => {
				console.error('Sigma OAuth callback error:', err)
				const msg =
					err instanceof Error
						? err.message
						: typeof err === 'object' && err !== null && 'message' in err
							? String(err.message)
							: 'Authentication failed'
				setError(msg)
			})
	}, [redirectTo])

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
			<p style={{ color: '#666' }}>Connecting wallet...</p>
		</div>
	)
}
