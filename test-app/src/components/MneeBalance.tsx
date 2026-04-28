import { getMneeBalance, type GetMneeBalanceResult } from '@1sat/actions'
import { useState } from 'react'
import { card, heading, button, buttonDisabled, errorText, mono } from './styles'
import { useLog } from './LogContext'
import { useOneSatContext } from './useActions'
import { useMneeAddresses } from './useMneeAddresses'

export function MneeBalance() {
  const ctx = useOneSatContext()
  const { addresses } = useMneeAddresses()
  const { log } = useLog()
  const [result, setResult] = useState<GetMneeBalanceResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const disabled = !ctx || loading || addresses.length === 0

  async function handleFetch() {
    if (!ctx || disabled) return
    setLoading(true)
    setError(null)
    log('info', `getMneeBalance for ${addresses.length} addresses...`)

    try {
      const res = await getMneeBalance.execute(ctx, { addresses })
      setResult(res)
      log('success', `MNEE balance: $${res.totalDecimal.toFixed(2)} (${res.balances.length} addresses)`)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(msg)
      log('error', `getMneeBalance failed: ${msg}`)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={heading}>MNEE Balance</div>
        <button
          style={disabled ? buttonDisabled : { ...button, fontSize: '0.75rem', padding: '0.3rem 0.6rem' }}
          disabled={disabled}
          onClick={handleFetch}
        >
          {loading ? 'Loading...' : 'Refresh'}
        </button>
      </div>

      {result && (
        <div style={{ marginBottom: '0.5rem' }}>
          <div style={{ fontSize: '1.2rem', fontWeight: 700, color: '#22c55e' }}>
            ${result.totalDecimal.toFixed(2)} MNEE
          </div>
          <div style={{ fontSize: '0.7rem', color: '#888' }}>
            {result.totalAtomic.toLocaleString()} atomic units
          </div>
        </div>
      )}

      {result && result.balances.length > 0 && (
        <div style={{ maxHeight: '150px', overflow: 'auto' }}>
          {result.balances.map(b => (
            <div key={b.address} style={{ padding: '0.25rem 0', borderBottom: '1px solid #1a1a1a', fontSize: '0.75rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={mono}>{b.address.slice(0, 8)}...{b.address.slice(-4)}</span>
                <span style={{ color: b.decimalAmount > 0 ? '#22c55e' : '#888' }}>
                  ${b.decimalAmount.toFixed(2)}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {!result && !error && (
        <p style={{ color: '#666', fontSize: '0.8rem' }}>
          {ctx ? (addresses.length > 0 ? 'Click Refresh' : 'Deriving addresses...') : 'Connect wallet first'}
        </p>
      )}

      {error && <div style={errorText}>{error}</div>}
    </div>
  )
}
