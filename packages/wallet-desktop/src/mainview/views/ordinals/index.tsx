import { useCallback, useEffect, useState } from 'react'
import type { OrdinalInfo } from '../../../shared/types'
import { OrdinalsGridUI, type OrdinalOutput } from '@/components/blocks/ordinals-grid'
import { rpc } from '../../rpc'

/** Map the RPC OrdinalInfo shape to the BigBlocks OrdinalOutput shape */
function toOrdinalOutput(o: OrdinalInfo): OrdinalOutput {
	const getTag = (prefix: string) => {
		const tag = o.tags.find((t) => t.startsWith(prefix))
		return tag ? tag.slice(prefix.length) : undefined
	}

	const origin = getTag('origin:') ?? o.outpoint
	const contentType = getTag('type:') ?? ''
	const name = getTag('name:')

	return {
		outpoint: o.outpoint.replace('.', '_'),
		contentType,
		name,
		origin: origin.replace('.', '_'),
		satoshis: o.satoshis,
		tags: o.tags,
	}
}

export function OrdinalsView() {
	const [ordinals, setOrdinals] = useState<OrdinalOutput[]>([])
	const [loading, setLoading] = useState(true)
	const [error, setError] = useState<Error | null>(null)

	useEffect(() => {
		rpc.request
			.getOrdinals({ limit: 50 })
			.then((result) => {
				setOrdinals(result.ordinals.map(toOrdinalOutput))
			})
			.catch((err) => {
				setError(
					err instanceof Error
						? err
						: new Error('Failed to load ordinals'),
				)
			})
			.finally(() => {
				setLoading(false)
			})
	}, [])

	const handleSelect = useCallback((ordinal: OrdinalOutput) => {
		console.log('Selected ordinal:', ordinal.outpoint)
	}, [])

	return (
		<div className="p-4">
			<OrdinalsGridUI
				items={ordinals}
				isLoading={loading}
				error={error}
				count={ordinals.length}
				onSelect={handleSelect}
				showCount
			/>
		</div>
	)
}
