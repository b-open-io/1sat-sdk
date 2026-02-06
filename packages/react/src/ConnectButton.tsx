'use client'

import type { ReactNode } from 'react'
import { useOneSatContext } from './context'

export interface ConnectButtonProps {
	/** Custom class name for the button */
	className?: string
	/** Custom styles for the button */
	style?: React.CSSProperties
	/** Text to show when disconnected */
	connectLabel?: ReactNode
	/** Text to show when connecting */
	connectingLabel?: ReactNode
	/** Text to show when connected (receives address) */
	connectedLabel?: ReactNode | ((address: string) => ReactNode)
	/** Called after successful connection */
	onConnect?: () => void
	/** Called after disconnection */
	onDisconnect?: () => void
	/** Called on error */
	onError?: (error: Error) => void
	/** Whether to disconnect on click when connected */
	disconnectOnClick?: boolean
	/** Custom render function for full control */
	children?: (props: {
		isConnected: boolean
		isConnecting: boolean
		address: string | null
		connect: () => Promise<void>
		disconnect: () => Promise<void>
	}) => ReactNode
}

/**
 * Truncate an address for display
 */
function truncateAddress(address: string): string {
	if (address.length <= 12) return address
	return `${address.slice(0, 6)}...${address.slice(-4)}`
}

/**
 * Ready-to-use connect button component
 *
 * @example
 * ```tsx
 * // Basic usage
 * <ConnectButton />
 *
 * // With custom labels
 * <ConnectButton
 *   connectLabel="Connect 1Sat"
 *   connectingLabel="Connecting..."
 *   connectedLabel={(addr) => `Connected: ${addr}`}
 * />
 *
 * // With custom render
 * <ConnectButton>
 *   {({ isConnected, connect, disconnect }) => (
 *     <button onClick={isConnected ? disconnect : connect}>
 *       {isConnected ? 'Disconnect' : 'Connect'}
 *     </button>
 *   )}
 * </ConnectButton>
 * ```
 */
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
		isConnected,
		isConnecting,
		paymentAddress,
		connect: providerConnect,
		disconnect: providerDisconnect,
	} = useOneSatContext()

	const connect = async () => {
		try {
			await providerConnect()
			onConnect?.()
		} catch (e) {
			onError?.(e instanceof Error ? e : new Error(String(e)))
		}
	}

	const disconnect = async () => {
		try {
			await providerDisconnect()
			onDisconnect?.()
		} catch (e) {
			onError?.(e instanceof Error ? e : new Error(String(e)))
		}
	}

	// Custom render function
	if (children) {
		return (
			<>
				{children({
					isConnected,
					isConnecting,
					address: paymentAddress,
					connect,
					disconnect,
				})}
			</>
		)
	}

	// Default button rendering
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
				? connectedLabel(paymentAddress ?? '')
				: (connectedLabel ?? truncateAddress(paymentAddress ?? ''))

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
