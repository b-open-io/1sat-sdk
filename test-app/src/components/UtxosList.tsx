import { useWallet } from '@1sat/react'
import type { WalletOutput } from '@bsv/sdk'
import { useState } from 'react'
import { card, heading, button, buttonDisabled, errorText, mono } from './styles'
import { useLog } from './LogContext'

export function UtxosList() {
  const { wallet, status } = useWallet()
  const { log } = useLog()
  const [utxos, setUtxos] = useState<WalletOutput[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const disabled = status !== 'connected' || loading

  async function handleFetch() {
    if (!wallet || disabled) return
    setLoading(true)
    setError(null)
    log('info', 'wallet.listOutputs (payment UTXOs)...')

    try {
      const result = await wallet.listOutputs({
        basket: 'default',
        include: 'locking scripts',
        limit: 200,
      })

      const paymentUtxos = result.outputs.filter(o => o.satoshis > 1)
      const sum = paymentUtxos.reduce((s, u) => s + u.satoshis, 0)
      setUtxos(paymentUtxos)
      setTotal(sum)
      log('success', `${paymentUtxos.length} payment UTXOs, total: ${sum.toLocaleString()} sat`)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(msg)
      log('error', `listOutputs failed: ${msg}`)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={heading}>Payment UTXOs</div>
        <button
          style={disabled ? buttonDisabled : { ...button, fontSize: '0.75rem', padding: '0.3rem 0.6rem' }}
          disabled={disabled}
          onClick={handleFetch}
        >
          {loading ? 'Loading...' : 'Refresh'}
        </button>
      </div>

      {total > 0 && (
        <div style={{ fontSize: '0.8rem', color: '#22c55e', marginBottom: '0.5rem' }}>
          Total: {total.toLocaleString()} satoshis ({utxos.length} UTXOs)
        </div>
      )}

      {utxos.length === 0 && !error && (
        <p style={{ color: '#666', fontSize: '0.8rem' }}>
          {status === 'connected' ? 'Click Refresh' : 'Connect wallet first'}
        </p>
      )}

      <div style={{ maxHeight: '300px', overflow: 'auto' }}>
        {utxos.map(u => (
          <div
            key={u.outpoint}
            style={{
              padding: '0.5rem',
              borderBottom: '1px solid #1a1a1a',
              display: 'flex',
              justifyContent: 'space-between',
              fontSize: '0.8rem',
            }}
          >
            <span style={mono}>{u.outpoint}</span>
            <span style={{ color: '#888', whiteSpace: 'nowrap', marginLeft: '0.5rem' }}>
              {u.satoshis.toLocaleString()} sat
            </span>
          </div>
        ))}
      </div>

      {error && <div style={errorText}>{error}</div>}
    </div>
  )
}
