import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
	children: ReactNode
}

interface State {
	error: Error | null
}

/**
 * Catches React render errors and shows a diagnostic screen
 * instead of a blank page. Displays the error message and stack
 * so users can report the issue.
 */
export class ErrorBoundary extends Component<Props, State> {
	state: State = { error: null }

	static getDerivedStateFromError(error: Error): State {
		return { error }
	}

	componentDidCatch(error: Error, info: ErrorInfo) {
		console.error('[ErrorBoundary]', error.message, info.componentStack)
	}

	render() {
		if (!this.state.error) return this.props.children

		return (
			<div
				style={{
					minHeight: '100vh',
					display: 'flex',
					alignItems: 'center',
					justifyContent: 'center',
					background: '#09090b',
					color: '#fafafa',
					fontFamily: 'system-ui, -apple-system, sans-serif',
					padding: 32,
				}}
			>
				<div style={{ maxWidth: 480, width: '100%' }}>
					<h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>
						Something went wrong
					</h1>
					<p style={{ fontSize: 13, color: '#a1a1aa', marginBottom: 24 }}>
						The app encountered an error during startup. This information can
						help diagnose the issue.
					</p>
					<div
						style={{
							background: '#18181b',
							border: '1px solid #27272a',
							padding: 16,
							fontSize: 12,
							fontFamily: 'JetBrains Mono, monospace',
							color: '#ef4444',
							whiteSpace: 'pre-wrap',
							wordBreak: 'break-word',
							maxHeight: 300,
							overflow: 'auto',
							marginBottom: 16,
						}}
					>
						{this.state.error.message}
						{this.state.error.stack && (
							<>
								{'\n\n'}
								<span style={{ color: '#71717a' }}>
									{this.state.error.stack}
								</span>
							</>
						)}
					</div>
					<div style={{ display: 'flex', gap: 8 }}>
						<button
							type="button"
							onClick={() => window.location.reload()}
							style={{
								padding: '8px 16px',
								background: '#3b82f6',
								color: '#fff',
								border: 'none',
								fontSize: 13,
								fontWeight: 500,
								cursor: 'pointer',
							}}
						>
							Reload
						</button>
						<button
							type="button"
							onClick={() => {
								navigator.clipboard.writeText(
									`${this.state.error?.message}\n${this.state.error?.stack ?? ''}`,
								)
							}}
							style={{
								padding: '8px 16px',
								background: '#27272a',
								color: '#a1a1aa',
								border: '1px solid #3f3f46',
								fontSize: 13,
								cursor: 'pointer',
							}}
						>
							Copy Error
						</button>
					</div>
				</div>
			</div>
		)
	}
}
