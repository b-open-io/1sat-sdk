'use client'

import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react'
import { useWallet } from './wallet-context'

export interface ConnectDialogProviderInfo {
	type: string
	name: string
	icon?: string
	isConnecting: boolean
	connect: () => void
}

export interface ConnectDialogRenderProps {
	providers: ConnectDialogProviderInfo[]
	error: Error | null
	close: () => void
}

export interface ConnectDialogProps {
	/** Controlled open state */
	open: boolean
	/** Called when dialog should close */
	onOpenChange: (open: boolean) => void
	/** Render the dialog content. If omitted, a basic unstyled list is rendered. */
	children?: (props: ConnectDialogRenderProps) => ReactNode
}

/**
 * Dialog for selecting a wallet provider when auto-detect finds nothing.
 *
 * Provides a list of available providers from WalletProvider config.
 * Supports custom rendering via render-prop children, or renders a
 * basic unstyled dialog if no children are provided.
 */
export function ConnectDialog({
	open,
	onOpenChange,
	children,
}: ConnectDialogProps) {
	const { availableProviders, connect, error } = useWallet()
	const [connectingType, setConnectingType] = useState<string | null>(null)
	const dialogRef = useRef<HTMLDialogElement>(null)

	useEffect(() => {
		const dialog = dialogRef.current
		if (!dialog) return
		if (open && !dialog.open) {
			dialog.showModal()
		} else if (!open && dialog.open) {
			dialog.close()
		}
	}, [open])

	const handleClose = useCallback(() => {
		onOpenChange(false)
	}, [onOpenChange])

	const handleConnect = useCallback(
		(providerType: string) => {
			setConnectingType(providerType)
			connect(providerType).finally(() => {
				setConnectingType(null)
			})
		},
		[connect],
	)

	const providers: ConnectDialogProviderInfo[] = availableProviders.map(
		(p) => ({
			type: p.type,
			name: p.name,
			icon: p.icon,
			isConnecting: connectingType === p.type,
			connect: () => handleConnect(p.type),
		}),
	)

	const renderProps: ConnectDialogRenderProps = {
		providers,
		error,
		close: handleClose,
	}

	return (
		<dialog
			ref={dialogRef}
			onClose={handleClose}
			style={{
				padding: 0,
				border: 'none',
				borderRadius: '0.75rem',
				maxWidth: '24rem',
				width: '100%',
				background: 'var(--background, #fff)',
				color: 'var(--foreground, #000)',
			}}
		>
			{children ? (
				children(renderProps)
			) : (
				<div style={{ padding: '1.5rem' }}>
					<h2
						style={{
							margin: '0 0 0.25rem',
							fontSize: '1.125rem',
							fontWeight: 600,
						}}
					>
						Connect Wallet
					</h2>
					<p
						style={{
							margin: '0 0 1rem',
							fontSize: '0.875rem',
							opacity: 0.6,
						}}
					>
						Choose how to connect.
					</p>
					<div
						style={{
							display: 'flex',
							flexDirection: 'column',
							gap: '0.5rem',
						}}
					>
						{providers.map((provider) => (
							<button
								key={provider.type}
								type="button"
								disabled={provider.isConnecting}
								onClick={provider.connect}
								style={{
									display: 'flex',
									alignItems: 'center',
									gap: '0.75rem',
									width: '100%',
									padding: '0.75rem 1rem',
									border: '1px solid #e5e5e5',
									borderRadius: '0.5rem',
									background: 'transparent',
									cursor: provider.isConnecting ? 'wait' : 'pointer',
									fontSize: '0.875rem',
									opacity: provider.isConnecting ? 0.6 : 1,
								}}
							>
								{provider.name}
								{provider.isConnecting && ' ...'}
							</button>
						))}
					</div>
					{error && (
						<p
							style={{
								marginTop: '0.75rem',
								fontSize: '0.875rem',
								color: '#dc2626',
							}}
						>
							{error.message}
						</p>
					)}
				</div>
			)}
		</dialog>
	)
}
