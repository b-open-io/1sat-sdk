import { ConnectButton, useWallet } from '@1sat/react'
import { useEffect, useRef } from 'react'
import { button as btnStyle } from './styles'
import { useLog } from './LogContext'

export function Header() {
  const { status, providerType, identityKey, disconnectReason } = useWallet()
  const { log } = useLog()
  const prevIdentity = useRef<string | null>(null)

  // Session poll surfaces identity/auth changes via context (no Yours tab events).
  useEffect(() => {
    if (identityKey && prevIdentity.current && identityKey !== prevIdentity.current) {
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

  return (
    <header style={headerStyle}>
      <div>
        <h1 style={{ fontSize: '1.25rem', fontWeight: 700 }}>1Sat SDK Test App</h1>
        <span style={{ fontSize: '0.75rem', color: '#666' }}>
          Status: {status}
          {providerType ? ` (${providerType})` : ''}
          {identityKey ? ` | ${identityKey.slice(0, 8)}…${identityKey.slice(-4)}` : ''}
          {disconnectReason ? ` | last: ${disconnectReason}` : ''}
          {' | local packages'}
        </span>
      </div>
      <ConnectButton
        style={btnStyle}
        connectLabel="Connect Wallet"
        connectingLabel="Connecting..."
        connectedLabel="Disconnect"
        disconnectOnClick
      />
    </header>
  )
}

const headerStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  padding: '1rem 0',
  borderBottom: '1px solid #2a2a2a',
  marginBottom: '1.5rem',
}
