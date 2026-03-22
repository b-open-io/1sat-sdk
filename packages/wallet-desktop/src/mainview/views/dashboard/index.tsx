import { WalletOverviewUI, type WalletBalance } from '@/components/blocks/wallet-overview'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useWallet } from '../../hooks/use-wallet'

export function OverviewView() {
	const { balance, getReceiveInfo } = useWallet()
	const [paymentAddress, setPaymentAddress] = useState<string | null>(null)

	useEffect(() => {
		getReceiveInfo().then(
			(info) => setPaymentAddress(info.address),
			(err) => console.error('Failed to get receive info:', err),
		)
	}, [getReceiveInfo])

	const walletBalance: WalletBalance = useMemo(
		() => ({
			confirmed: balance.confirmed,
			unconfirmed: balance.unconfirmed,
			total: balance.confirmed + balance.unconfirmed,
		}),
		[balance],
	)

	const handleRefresh = useCallback(() => {
		// Balance is automatically refreshed via RPC subscription
	}, [])

	return (
		<div className="space-y-6 max-w-2xl">
			<div>
				<h2 className="text-xl font-bold text-foreground">Welcome</h2>
				<p className="text-sm text-muted-foreground mt-1">
					Your wallet at a glance
				</p>
			</div>

			<WalletOverviewUI
				balance={walletBalance}
				paymentAddress={paymentAddress}
				ordinalAddress={null}
				identityKey={null}
				isLoading={false}
				error={null}
				onRefresh={handleRefresh}
			/>
		</div>
	)
}
