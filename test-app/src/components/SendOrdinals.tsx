import { getOrdinals, transferOrdinals } from '@1sat/actions'
import { useState } from 'react'
import { card, heading, input, button, buttonDisabled, successText, errorText, label } from './styles'
import { useLog } from './LogContext'
import { useOneSatContext } from './useActions'

export function SendOrdinals() {
  const ctx = useOneSatContext()
  const { log } = useLog()
  const [outpoint, setOutpoint] = useState('')
  const [destAddress, setDestAddress] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const disabled = !ctx || loading || !outpoint || !destAddress

  async function handleSend() {
    if (!ctx || disabled) return
    setLoading(true)
    setResult(null)
    setError(null)
    log('info', `transferOrdinals: ${outpoint} to ${destAddress}`)

    try {
      // First get the ordinal outputs with BEEF
      const ordsResult = await getOrdinals.execute(ctx, {})
      const ordinal = ordsResult.outputs.find(o => o.outpoint === outpoint)
      if (!ordinal) throw new Error(`Outpoint ${outpoint} not found in wallet`)
      if (!ordsResult.BEEF) throw new Error('No BEEF returned from getOrdinals')

      const res = await transferOrdinals.execute(ctx, {
        transfers: [{ ordinal, address: destAddress }],
        inputBEEF: Array.from(ordsResult.BEEF),
      })

      if (res.error) throw new Error(res.error)
      setResult(res.txid ?? 'no txid')
      log('success', `transferOrdinals txid: ${res.txid}`)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(msg)
      log('error', `transferOrdinals failed: ${msg}`)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={card}>
      <div style={heading}>Send Ordinals</div>
      <label style={label}>Outpoint (txid.vout)</label>
      <input style={input} placeholder="abc123...def.0" value={outpoint} onChange={e => setOutpoint(e.target.value)} />
      <label style={label}>Destination Address</label>
      <input style={input} placeholder="1A1zP1..." value={destAddress} onChange={e => setDestAddress(e.target.value)} />
      <button style={disabled ? buttonDisabled : button} disabled={disabled} onClick={handleSend}>
        {loading ? 'Sending...' : 'Send Ordinal'}
      </button>
      {result && <div style={successText}>TXID: {result}</div>}
      {error && <div style={errorText}>{error}</div>}
    </div>
  )
}
