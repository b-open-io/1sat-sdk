import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useState,
} from 'react'

interface LogEntry {
	id: number
	time: string
	type: 'info' | 'success' | 'error'
	message: string
}

interface LogContextValue {
	entries: LogEntry[]
	log: (type: LogEntry['type'], message: string) => void
	clear: () => void
}

const LogContext = createContext<LogContextValue | null>(null)

let nextId = 0

export function LogProvider({ children }: { children: ReactNode }) {
	const [entries, setEntries] = useState<LogEntry[]>([])

	const log = useCallback((type: LogEntry['type'], message: string) => {
		const entry: LogEntry = {
			id: nextId++,
			time: new Date().toLocaleTimeString(),
			type,
			message,
		}
		setEntries((prev) => [entry, ...prev].slice(0, 100))
	}, [])

	const clear = useCallback(() => setEntries([]), [])

	return (
		<LogContext.Provider value={{ entries, log, clear }}>
			{children}
		</LogContext.Provider>
	)
}

export function useLog() {
	const ctx = useContext(LogContext)
	if (!ctx) throw new Error('useLog must be inside LogProvider')
	return ctx
}
