'use client'

import type { ReactNode } from 'react'
import { useWallet } from './wallet-context'

export interface ConnectButtonProps {
	className?: string
	style?: React.CSSProperties
	connectLabel?: ReactNode
	connectingLabel?: ReactNode
	connectedLabel?: ReactNode | ((identityKey: string) => ReactNode)
	onConnect?: () => void
	onDisconnect?: () => void
	onError?: (error: Error) => void
	disconnectOnClick?: boolean
	children?: (props: {
		isConnected: boolean
		isConnecting: boolean
		identityKey: string | null
		connect: () => Promise<void>
		disconnect: () => void
	}) => ReactNode
}

function truncateIdentityKey(key: string): string {
	if (key.length <= 12) return key
	return `${key.slice(0, 6)}...${key.slice(-4)}`
}

export function ConnectButton({
	className,
	style,
	connectLabel = 'Connect Wallet',
	connectingLabel = 'Connecting...',
	connectedLabel,
	onConnect,
	onDisconnect,
	onError,
	disconnectOnClick = true,
	children,
}: ConnectButtonProps) {
	const {
		status,
		identityKey,
		connect: walletConnect,
		disconnect: walletDisconnect,
	} = useWallet()

	const isConnected = status === 'connected'
	const isConnecting = status === 'detecting' || status === 'connecting'

	const connect = async () => {
		try {
			await walletConnect()
			onConnect?.()
		} catch (e) {
			onError?.(e instanceof Error ? e : new Error(String(e)))
		}
	}

	const disconnect = () => {
		try {
			walletDisconnect()
			onDisconnect?.()
		} catch (e) {
			onError?.(e instanceof Error ? e : new Error(String(e)))
		}
	}

	if (children) {
		return (
			<>
				{children({
					isConnected,
					isConnecting,
					identityKey,
					connect,
					disconnect,
				})}
			</>
		)
	}

	if (isConnecting) {
		return (
			<button className={className} style={style} disabled type="button">
				{connectingLabel}
			</button>
		)
	}

	if (isConnected) {
		const label =
			typeof connectedLabel === 'function'
				? connectedLabel(identityKey ?? '')
				: (connectedLabel ?? truncateIdentityKey(identityKey ?? ''))

		return (
			<button
				className={className}
				style={style}
				onClick={disconnectOnClick ? disconnect : undefined}
				type="button"
			>
				{label}
			</button>
		)
	}

	return (
		<button className={className} style={style} onClick={connect} type="button">
			{connectLabel}
		</button>
	)
}
