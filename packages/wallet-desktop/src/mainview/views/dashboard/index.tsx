import { Card, CardContent, CardTitle } from '@/components/ui/card'
import { useWallet } from '../../hooks/use-wallet'

function formatBsv(satoshis: number): string {
	return (satoshis / 1e8).toFixed(8)
}

export function OverviewView() {
	const { balance } = useWallet()

	return (
		<div className="space-y-6">
			<div>
				<h2 className="text-xl font-bold text-foreground">Welcome</h2>
				<p className="text-sm text-muted-foreground mt-1">
					Your wallet at a glance
				</p>
			</div>

			<div className="grid grid-cols-3 gap-4">
				<Card>
					<CardContent className="p-5">
						<CardTitle className="text-xs font-mono uppercase tracking-wider text-muted-foreground mb-2">
							BSV Balance
						</CardTitle>
						<div className="text-lg font-mono text-foreground">
							{formatBsv(balance.confirmed)}
						</div>
					</CardContent>
				</Card>

				<Card>
					<CardContent className="p-5">
						<CardTitle className="text-xs font-mono uppercase tracking-wider text-muted-foreground mb-2">
							Ordinals
						</CardTitle>
						<div className="text-lg font-mono text-foreground">
							--
						</div>
					</CardContent>
				</Card>

				<Card>
					<CardContent className="p-5">
						<CardTitle className="text-xs font-mono uppercase tracking-wider text-muted-foreground mb-2">
							Tokens
						</CardTitle>
						<div className="text-lg font-mono text-foreground">
							--
						</div>
					</CardContent>
				</Card>
			</div>

			<Card>
				<CardContent className="p-5">
					<CardTitle className="text-xs font-mono uppercase tracking-wider text-muted-foreground mb-3">
						Recent Activity
					</CardTitle>
					<p className="text-sm text-muted-foreground">
						No recent activity to display.
					</p>
				</CardContent>
			</Card>
		</div>
	)
}
