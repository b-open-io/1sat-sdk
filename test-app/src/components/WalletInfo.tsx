import { useWallet } from '@1sat/react'
import { deriveDepositAddresses } from '@1sat/actions'
import { useEffect, useState } from 'react'
import { card, heading, mono } from './styles'
import { useLog } from './LogContext'
import { useOneSatContext } from './useActions'

export function WalletInfo() {
  const { status, identityKey } = useWallet()
  const ctx = useOneSatContext()
  const { log } = useLog()
  const [balance, setBalance] = useState<number | null>(null)
  const [outputCount, setOutputCount] = useState(0)
  const [payAddr, setPayAddr] = useState<string | null>(null)
  const [ordAddr, setOrdAddr] = useState<string | null>(null)

  useEffect(() => {
    if (!ctx) return
    log('success', `Connected via @1sat/connect. Identity: ${identityKey?.slice(0, 16)}...`)

    // Get balance from listOutputs
    ctx.wallet.listOutputs({ basket: 'default', limit: 1000 }).then(result => {
      const total = result.outputs.reduce((s, o) => s + o.satoshis, 0)
      setBalance(total)
      setOutputCount(result.outputs.length)
      log('info', `Balance: ${total.toLocaleString()} sat (${result.outputs.length} outputs)`)
    }).catch(err => log('error', `listOutputs failed: ${err.message}`))

    // Derive deposit addresses (index 0 = payment, index 1 = ordinal)
    deriveDepositAddresses.execute(ctx, { startIndex: 0, count: 2 }).then(res => {
      const payAddress = res.derivations[0]?.address
      const ordAddress = res.derivations[1]?.address
      setPayAddr(payAddress ?? null)
      setOrdAddr(ordAddress ?? null)
      log('info', `Payment: ${payAddress}, Ordinal: ${ordAddress}`)
    }).catch(err => log('error', `deriveDepositAddresses failed: ${err.message}`))
  }, [ctx, identityKey, log])

  if (status !== 'connected') {
    return (
      <div style={card}>
        <p style={{ color: '#666', textAlign: 'center', padding: '2rem 0' }}>
          Connect your Yours Wallet to begin testing
        </p>
      </div>
    )
  }

  return (
    <div style={card}>
      <div style={heading}>Wallet Details (@1sat/connect + @1sat/actions v0.0.69)</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
        <div>
          <span style={labelStyle}>Identity Key</span>
          <div style={mono}>{identityKey ?? 'N/A'}</div>
        </div>
        <div>
          <span style={labelStyle}>Balance</span>
          <div style={mono}>
            {balance != null ? `${balance.toLocaleString()} sat (${outputCount} outputs)` : 'Loading...'}
          </div>
        </div>
        <div>
          <span style={labelStyle}>Payment Address</span>
          <div style={mono}>{payAddr ?? 'Loading...'}</div>
        </div>
        <div>
          <span style={labelStyle}>Ordinal Address</span>
          <div style={mono}>{ordAddr ?? 'Loading...'}</div>
        </div>
      </div>
    </div>
  )
}

const labelStyle: React.CSSProperties = { color: '#888', fontSize: '0.75rem' }
