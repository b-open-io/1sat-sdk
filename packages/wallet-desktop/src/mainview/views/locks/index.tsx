import { useCallback, useEffect, useState } from 'react'
import { LockBsv } from '@/components/blocks/lock-bsv'
import { rpc } from '../../rpc'

export function LocksView() {
	const [lockData, setLockData] = useState<{
		totalLocked: number
		unlockable: number
		nextUnlock: number
	}>({ totalLocked: 0, unlockable: 0, nextUnlock: 0 })

	useEffect(() => {
		rpc.request
			.getLockData()
			.then((data) => setLockData(data))
			.catch((err) =>
				console.error('Failed to load lock data:', err),
			)
	}, [])

	const handleLock = useCallback(
		async (params: { satoshis: number; until: number }) => {
			const result = await rpc.request.lockBsv(params)
			if (!result.error) {
				// Refresh lock data after successful lock
				const data = await rpc.request.getLockData()
				setLockData(data)
			}
			return result
		},
		[],
	)

	const handleUnlock = useCallback(async () => {
		const result = await rpc.request.unlockBsv()
		if (!result.error) {
			// Refresh lock data after successful unlock
			const data = await rpc.request.getLockData()
			setLockData(data)
		}
		return result
	}, [])

	return (
		<div className="p-6 max-w-2xl">
			<div className="text-xs font-mono uppercase tracking-wider text-muted-foreground mb-4">
				Time Locks
			</div>
			<LockBsv
				lockData={lockData}
				onLock={handleLock}
				onUnlock={handleUnlock}
				onSuccess={(result) => {
					if (result.txid) {
						console.log('Lock operation txid:', result.txid)
					}
				}}
			/>
		</div>
	)
}
