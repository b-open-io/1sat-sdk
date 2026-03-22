import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useWallet } from '../../hooks/use-wallet'

export function OverviewView() {
	const { balance } = useWallet()

	const bsvAmount = (balance.confirmed / 1e8).toFixed(8)

	return (
		<div className="space-y-6 max-w-2xl">
			<div>
				<h2 className="text-xl font-bold text-foreground">Overview</h2>
				<p className="text-sm text-muted-foreground mt-1">
					Your wallet at a glance
				</p>
			</div>

			<div className="grid grid-cols-3 gap-4">
				<Card>
					<CardHeader className="pb-2">
						<CardTitle className="text-sm font-medium text-muted-foreground">
							BSV Balance
						</CardTitle>
					</CardHeader>
					<CardContent>
						<p className="text-2xl font-bold font-mono">{bsvAmount}</p>
					</CardContent>
				</Card>

				<Card>
					<CardHeader className="pb-2">
						<CardTitle className="text-sm font-medium text-muted-foreground">
							Ordinals
						</CardTitle>
					</CardHeader>
					<CardContent>
						<p className="text-2xl font-bold font-mono">--</p>
					</CardContent>
				</Card>

				<Card>
					<CardHeader className="pb-2">
						<CardTitle className="text-sm font-medium text-muted-foreground">
							Tokens
						</CardTitle>
					</CardHeader>
					<CardContent>
						<p className="text-2xl font-bold font-mono">--</p>
					</CardContent>
				</Card>
			</div>
		</div>
	)
}
