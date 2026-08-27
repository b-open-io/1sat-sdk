import { ConnectButton, useWallet } from '@1sat/react'
import { useEffect, useRef } from 'react'
import { useLocalCwi } from '../localCwi/LocalCwiHost'
import { useLog } from './LogContext'
import { button as btnStyle } from './styles'

export function Header() {
	const { status, providerType, identityKey, disconnectReason } = useWallet()
	const local = useLocalCwi()
	const { log } = useLog()
	const prevIdentity = useRef<string | null>(null)

	useEffect(() => {
		if (
			identityKey &&
			prevIdentity.current &&
			identityKey !== prevIdentity.current
		) {
			log(
				'info',
				`Identity changed: ${prevIdentity.current.slice(0, 8)}… → ${identityKey.slice(0, 8)}…`,
			)
		}
		if (!identityKey && prevIdentity.current && disconnectReason) {
			log('error', `Session ended (${disconnectReason})`)
		}
		prevIdentity.current = identityKey
	}, [identityKey, disconnectReason, log])

	useEffect(() => {
		if (local.status === 'ready') {
			log(
				'info',
				`Local gated wallet ready${local.localEnabled ? ' (window.CWI on)' : ' (window.CWI off)'}`,
			)
		}
		if (local.status === 'error' && local.error) {
			log('error', `Local CWI failed: ${local.error}`)
		}
	}, [local.status, local.error, local.localEnabled, log])

	const usingLocal =
		local.localEnabled && local.status === 'ready' && local.gatedWallet

	return (
		<header style={headerStyle}>
			<div style={{ minWidth: 0 }}>
				<h1 style={{ fontSize: '1.25rem', fontWeight: 700, margin: 0 }}>
					1Sat SDK Test App
				</h1>
				<span style={{ fontSize: '0.75rem', color: '#666' }}>
					{usingLocal ? (
						<>
							Local gated
							{local.identityKey
								? ` | ${local.identityKey.slice(0, 8)}…${local.identityKey.slice(-4)}`
								: ''}
							{' | '}
							{local.adminOriginator ? 'admin (no prompt)' : 'dApp (prompt)'}
						</>
					) : (
						<>
							Status: {status}
							{providerType ? ` (${providerType})` : ''}
							{identityKey
								? ` | ${identityKey.slice(0, 8)}…${identityKey.slice(-4)}`
								: ''}
							{disconnectReason ? ` | last: ${disconnectReason}` : ''}
						</>
					)}
				</span>
				<div style={togglesRow}>
					<label style={toggleLabel}>
						<input
							type="checkbox"
							checked={local.localEnabled}
							onChange={(e) => local.setLocalEnabled(e.target.checked)}
							disabled={local.status !== 'ready' && local.status !== 'error'}
						/>
						Local CWI
					</label>
					<label
						style={{
							...toggleLabel,
							opacity: local.localEnabled ? 1 : 0.45,
						}}
					>
						<input
							type="checkbox"
							checked={local.adminOriginator}
							onChange={(e) => local.setAdminOriginator(e.target.checked)}
							disabled={!local.localEnabled}
						/>
						Admin originator
					</label>
					<label
						style={{
							...toggleLabel,
							opacity: local.localEnabled ? 1 : 0.45,
						}}
						title="useOneSatModule on 1sat asset actions (p 1sat labels → module)"
					>
						<input
							type="checkbox"
							checked={local.useOneSatModule}
							onChange={(e) => local.setUseOneSatModule(e.target.checked)}
							disabled={!local.localEnabled}
						/>
						1Sat module
					</label>
					<button
						type="button"
						style={clearBtn}
						disabled={!local.localEnabled || local.status !== 'ready'}
						onClick={() => {
							void local.clearPermissionGrants().then((n) => {
								log('info', `Cleared ${n} permission grant(s)`)
							})
						}}
						title="Clear IndexedDB permission grants so prompts replay"
					>
						Clear grants
					</button>
					<span style={{ fontSize: '0.7rem', color: '#555' }}>
						{local.localEnabled
							? local.useOneSatModule
								? '1sat actions → module prompts'
								: '1sat actions → local pipeline (WPM core may prompt)'
							: 'Connect extension (disable Yours or Local to pick one)'}
					</span>
				</div>
			</div>
			{!local.localEnabled && (
				<ConnectButton
					style={btnStyle}
					connectLabel="Connect Wallet"
					connectingLabel="Connecting..."
					connectedLabel="Disconnect"
					disconnectOnClick
				/>
			)}
		</header>
	)
}

const headerStyle: React.CSSProperties = {
	display: 'flex',
	justifyContent: 'space-between',
	alignItems: 'flex-start',
	padding: '1rem 0',
	borderBottom: '1px solid #2a2a2a',
	marginBottom: '1.5rem',
	gap: '1rem',
}

const togglesRow: React.CSSProperties = {
	display: 'flex',
	flexWrap: 'wrap',
	alignItems: 'center',
	gap: '0.75rem',
	marginTop: '0.5rem',
}

const toggleLabel: React.CSSProperties = {
	display: 'inline-flex',
	alignItems: 'center',
	gap: '0.35rem',
	fontSize: '0.8rem',
	color: '#ccc',
	cursor: 'pointer',
	userSelect: 'none',
}

const clearBtn: React.CSSProperties = {
	fontSize: '0.7rem',
	padding: '0.2rem 0.45rem',
	background: '#333',
	color: '#ccc',
	border: '1px solid #555',
	borderRadius: 4,
	cursor: 'pointer',
}
