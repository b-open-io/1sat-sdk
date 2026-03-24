'use client'

import { type ReactNode, useCallback, useState } from 'react'
import { useWallet } from './wallet-context'

export interface WalletSelectorProviderInfo {
	type: string
	name: string
	icon?: string
	isConnecting: boolean
	connect: () => Promise<void>
}

export interface WalletSelectorRenderProps {
	providers: WalletSelectorProviderInfo[]
	error: Error | null
}

export interface WalletSelectorProps {
	onClose?: () => void
	children: (props: WalletSelectorRenderProps) => ReactNode
}

export function WalletSelector({ onClose, children }: WalletSelectorProps) {
	const { availableProviders, connect, error } = useWallet()
	const [connectingType, setConnectingType] = useState<string | null>(null)

	const handleConnect = useCallback(
		async (providerType: string) => {
			setConnectingType(providerType)
			try {
				await connect(providerType)
				onClose?.()
			} finally {
				setConnectingType(null)
			}
		},
		[connect, onClose],
	)

	const providers: WalletSelectorProviderInfo[] = availableProviders.map(
		(p) => ({
			type: p.type,
			name: p.name,
			icon: p.icon,
			isConnecting: connectingType === p.type,
			connect: () => handleConnect(p.type),
		}),
	)

	return <>{children({ providers, error })}</>
}
