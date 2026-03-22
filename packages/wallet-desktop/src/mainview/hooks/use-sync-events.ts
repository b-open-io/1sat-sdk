import { useEffect, useRef, useState } from 'react'
import type { SyncEvent } from '../../shared/types'
import { onSyncEvent } from '../rpc'

const MAX_EVENTS = 100

interface UseSyncEventsReturn {
	events: SyncEvent[]
}

export function useSyncEvents(): UseSyncEventsReturn {
	const [events, setEvents] = useState<SyncEvent[]>([])
	const eventsRef = useRef<SyncEvent[]>([])

	useEffect(() => {
		const unsub = onSyncEvent((event) => {
			const next = [...eventsRef.current, event]
			if (next.length > MAX_EVENTS) {
				next.splice(0, next.length - MAX_EVENTS)
			}
			eventsRef.current = next
			setEvents(next)
		})

		return unsub
	}, [])

	return { events }
}
