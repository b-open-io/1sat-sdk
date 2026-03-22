import { useCallback, useEffect, useState } from 'react'
import {
	OpnsManagerUI,
	type OpnsNameDisplay,
	type OpnsOperationResult,
} from '@/components/blocks/opns-manager'
import { rpc } from '../../rpc'

export function OpnsView() {
	const [names, setNames] = useState<OpnsNameDisplay[]>([])
	const [loading, setLoading] = useState(true)
	const [error, setError] = useState<Error | null>(null)
	const [operating, setOperating] = useState(false)

	const fetchNames = useCallback(async () => {
		try {
			const result = await rpc.request.getOpnsNames()
			setNames(
				result.names.map((n) => ({
					outpoint: n.outpoint,
					name: n.name,
					registered: n.tags.includes('opns:published'),
					identityKey: undefined,
				})),
			)
			setError(null)
		} catch (err) {
			setError(
				err instanceof Error
					? err
					: new Error('Failed to load OpNS names'),
			)
		} finally {
			setLoading(false)
		}
	}, [])

	useEffect(() => {
		fetchNames()
	}, [fetchNames])

	const handleRegister = useCallback(
		async (name: OpnsNameDisplay): Promise<OpnsOperationResult> => {
			setOperating(true)
			try {
				const result = await rpc.request.opnsRegister({
					outpoint: name.outpoint,
				})
				if (!result.error) {
					await fetchNames()
				}
				return result
			} finally {
				setOperating(false)
			}
		},
		[fetchNames],
	)

	const handleDeregister = useCallback(
		async (name: OpnsNameDisplay): Promise<OpnsOperationResult> => {
			setOperating(true)
			try {
				const result = await rpc.request.opnsDeregister({
					outpoint: name.outpoint,
				})
				if (!result.error) {
					await fetchNames()
				}
				return result
			} finally {
				setOperating(false)
			}
		},
		[fetchNames],
	)

	return (
		<div className="p-6 max-w-2xl">
			<div className="text-xs font-mono uppercase tracking-wider text-muted-foreground mb-4">
				OpNS Names
			</div>
			<OpnsManagerUI
				names={names}
				isLoading={loading}
				isOperating={operating}
				error={error}
				onRegister={handleRegister}
				onDeregister={handleDeregister}
				onRefresh={fetchNames}
			/>
		</div>
	)
}
