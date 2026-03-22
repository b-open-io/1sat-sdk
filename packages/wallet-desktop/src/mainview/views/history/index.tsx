import { useCallback, useEffect, useState } from 'react'
import {
	TransactionHistoryUI,
	type HistoryEntry,
} from '@/components/blocks/transaction-history'
import { rpc } from '../../rpc'

export function HistoryView() {
	const [entries, setEntries] = useState<HistoryEntry[]>([])
	const [loading, setLoading] = useState(true)
	const [error, setError] = useState<Error | null>(null)

	useEffect(() => {
		rpc.request
			.getTransactionHistory({ limit: 50 })
			.then((result) => {
				setEntries(
					result.entries.map((e) => ({
						txid: e.txid,
						description: e.description,
						satoshis: e.satoshis,
						status: e.status as HistoryEntry['status'],
						dateCreated: e.dateCreated,
					})),
				)
			})
			.catch((err) => {
				setError(
					err instanceof Error
						? err
						: new Error('Failed to load transaction history'),
				)
			})
			.finally(() => {
				setLoading(false)
			})
	}, [])

	const handleRowClick = useCallback((txid: string) => {
		console.log('Transaction clicked:', txid)
	}, [])

	return (
		<div className="p-6">
			<TransactionHistoryUI
				entries={entries}
				isLoading={loading}
				error={error}
				onRowClick={handleRowClick}
			/>
		</div>
	)
}
