import { useLog } from './LogContext'
import { button, card, heading } from './styles'

const colors = {
	info: '#60a5fa',
	success: '#22c55e',
	error: '#ef4444',
}

export function EventLog() {
	const { entries, clear } = useLog()

	return (
		<div style={{ ...card, marginTop: '1.5rem' }}>
			<div
				style={{
					display: 'flex',
					justifyContent: 'space-between',
					alignItems: 'center',
				}}
			>
				<div style={heading}>Event Log</div>
				<button
					style={{
						...button,
						fontSize: '0.7rem',
						padding: '0.25rem 0.5rem',
						background: '#333',
					}}
					onClick={clear}
				>
					Clear
				</button>
			</div>

			<div
				style={{
					maxHeight: '250px',
					overflow: 'auto',
					fontSize: '0.75rem',
					fontFamily: 'monospace',
				}}
			>
				{entries.length === 0 && <p style={{ color: '#666' }}>No events yet</p>}
				{entries.map((e) => (
					<div
						key={e.id}
						style={{ padding: '0.25rem 0', borderBottom: '1px solid #1a1a1a' }}
					>
						<span style={{ color: '#555' }}>{e.time}</span>{' '}
						<span style={{ color: colors[e.type] }}>[{e.type}]</span>{' '}
						<span style={{ wordBreak: 'break-all' }}>{e.message}</span>
					</div>
				))}
			</div>
		</div>
	)
}
