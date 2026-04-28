import { ConnectButton, useWallet } from '@1sat/react'
import { useEffect } from 'react'
import { button as btnStyle } from './styles'
import { useLog } from './LogContext'

export function Header() {
  const { status, providerType, disconnect, connect } = useWallet()
  const { log } = useLog()

  // Listen for Yours Wallet state changes (sign-out, account switch)
  useEffect(() => {
    const onWalletEvent = (e: Event) => {
      const detail = (e as CustomEvent).detail as { action?: string } | undefined
      if (!detail?.action) return

      if (detail.action === 'signedOut') {
        log('error', 'Wallet event: signedOut — disconnecting')
        disconnect()
      }
      if (detail.action === 'switchAccount') {
        log('info', 'Wallet event: switchAccount — reconnecting')
        disconnect()
        // Short delay to let the wallet finish switching before reconnecting
        setTimeout(() => connect(), 500)
      }
    }

    window.addEventListener('YoursEmitEvent', onWalletEvent)
    return () => window.removeEventListener('YoursEmitEvent', onWalletEvent)
  }, [log, disconnect, connect])

  return (
    <header style={headerStyle}>
      <div>
        <h1 style={{ fontSize: '1.25rem', fontWeight: 700 }}>1Sat SDK Test App</h1>
        <span style={{ fontSize: '0.75rem', color: '#666' }}>
          Status: {status}{providerType ? ` (${providerType})` : ''}
          {' | @1sat/connect + @1sat/react'}
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
