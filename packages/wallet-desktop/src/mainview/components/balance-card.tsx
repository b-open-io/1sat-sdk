import { Card, CardContent, CardTitle } from '@/components/ui/card'

interface BalanceCardProps {
	confirmed: number
	unconfirmed: number
}

function formatBsv(satoshis: number): string {
	return (satoshis / 1e8).toFixed(8)
}

export function BalanceCard({ confirmed, unconfirmed }: BalanceCardProps) {
	return (
		<Card>
			<CardContent className="p-6">
				<CardTitle className="mb-2">Balance</CardTitle>
				<div className="text-3xl font-mono text-foreground tracking-tight">
					{formatBsv(confirmed)}{' '}
					<span className="text-sm text-muted-foreground">BSV</span>
				</div>
				{unconfirmed !== 0 && (
					<div className="mt-2 text-sm font-mono text-muted-foreground">
						{unconfirmed > 0 ? '+' : ''}
						{formatBsv(unconfirmed)} unconfirmed
					</div>
				)}
			</CardContent>
		</Card>
	)
}
