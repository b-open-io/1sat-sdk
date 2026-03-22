import { useCallback, useEffect, useState } from 'react'
import type { OrdinalInfo } from '../../../shared/types'
import { OrdinalCard } from '../../components/ordinal-card'
import { OrdinalDetailModal } from '../../components/ordinal-detail-modal'
import { rpc } from '../../rpc'

export function OrdinalsView() {
	const [ordinals, setOrdinals] = useState<OrdinalInfo[]>([])
	const [loading, setLoading] = useState(true)
	const [selectedOrdinal, setSelectedOrdinal] = useState<OrdinalInfo | null>(
		null,
	)

	useEffect(() => {
		rpc.request
			.getOrdinals({ limit: 50 })
			.then((result) => {
				setOrdinals(result.ordinals)
			})
			.catch((err) => {
				console.error('Failed to load ordinals:', err)
			})
			.finally(() => {
				setLoading(false)
			})
	}, [])

	const handleClose = useCallback(() => {
		setSelectedOrdinal(null)
	}, [])

	if (loading) {
		return (
			<div className="p-6">
				<div className="text-xs font-mono uppercase tracking-wider text-muted-foreground mb-4">
					Ordinals
				</div>
				<p className="text-sm text-muted-foreground">Loading ordinals...</p>
			</div>
		)
	}

	if (ordinals.length === 0) {
		return (
			<div className="p-6">
				<div className="text-xs font-mono uppercase tracking-wider text-muted-foreground mb-4">
					Ordinals
				</div>
				<p className="text-sm text-muted-foreground">No ordinals found</p>
			</div>
		)
	}

	return (
		<div className="p-4">
			<div className="text-xs font-mono uppercase tracking-wider text-muted-foreground mb-4 px-2">
				Ordinals
			</div>
			<div className="grid grid-cols-3 gap-2">
				{ordinals.map((ordinal) => (
					<OrdinalCard
						key={ordinal.outpoint}
						ordinal={ordinal}
						onClick={() => setSelectedOrdinal(ordinal)}
					/>
				))}
			</div>
			{selectedOrdinal && (
				<OrdinalDetailModal ordinal={selectedOrdinal} onClose={handleClose} />
			)}
		</div>
	)
}
