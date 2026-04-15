import { Loader2, Wallet, X } from 'lucide-react'
import { useState } from 'react'
import {
	connectWallet,
	disconnectWallet,
	getIdentityKey,
	getProvider,
} from '../lib/wallet'
import { Button } from './ui/button'

interface Props {
	onConnected: () => void
	onDisconnected: () => void
	connected: boolean
}

export function ConnectWallet({
	onConnected,
	onDisconnected,
	connected,
}: Props) {
	const [connecting, setConnecting] = useState(false)
	const [error, setError] = useState<string | null>(null)

	async function handleConnect() {
		setConnecting(true)
		setError(null)
		try {
			await connectWallet()
			onConnected()
		} catch (e) {
			setError(e instanceof Error ? e.message : 'Failed to connect wallet')
		} finally {
			setConnecting(false)
		}
	}

	function handleDisconnect() {
		disconnectWallet()
		onDisconnected()
	}

	if (connected) {
		return (
			<div className="flex items-center justify-between px-3 py-2 rounded-lg border border-green-500/20 bg-green-500/5">
				<div className="flex items-center gap-2 text-sm">
					<span className="h-2 w-2 rounded-full bg-green-500" />
					<span className="text-muted-foreground">
						{getProvider() === 'brc100' ? 'BRC-100' : 'OneSat'} ·{' '}
						{getIdentityKey()?.slice(0, 12)}...
					</span>
				</div>
				<Button
					variant="ghost"
					size="sm"
					className="h-6 w-6 p-0"
					onClick={handleDisconnect}
				>
					<X className="h-3 w-3" />
				</Button>
			</div>
		)
	}

	return (
		<div className="space-y-1">
			<Button
				variant="outline"
				size="sm"
				className="w-full text-xs gap-2"
				onClick={handleConnect}
				disabled={connecting}
			>
				{connecting ? (
					<Loader2 className="h-3 w-3 animate-spin" />
				) : (
					<Wallet className="h-3 w-3" />
				)}
				{connecting ? 'Connecting...' : 'Connect BRC-100 Wallet (optional)'}
			</Button>
			{error && <p className="text-xs text-destructive text-center">{error}</p>}
		</div>
	)
}
