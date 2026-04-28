import { sendMnee } from '@1sat/actions'
import { useState } from 'react'
import { card, heading, input, button, buttonDisabled, successText, errorText, label, mono } from './styles'
import { useLog } from './LogContext'
import { useOneSatContext } from './useActions'
import { useMneeAddresses } from './useMneeAddresses'

export function SendMnee() {
  const ctx = useOneSatContext()
  const { derivations } = useMneeAddresses()
  const { log } = useLog()
  const [address, setAddress] = useState('')
  const [amount, setAmount] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<{ txid?: string; ticketId?: string } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const disabled = !ctx || loading || !address || !amount || derivations.length === 0

  async function handleSend() {
    if (!ctx || disabled) return
    setLoading(true)
    setResult(null)
    setError(null)
    log('info', `sendMnee: $${amount} to ${address}`)

    try {
      const res = await sendMnee.execute(ctx, {
        recipients: [{ address, amount: Number(amount) }],
        derivations,
      })

      if (res.error) throw new Error(res.error)
      setResult(res)
      log('success', `sendMnee: txid=${res.txid}, ticketId=${res.ticketId}`)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(msg)
      log('error', `sendMnee failed: ${msg}`)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={card}>
      <div style={heading}>Send MNEE</div>
      <label style={label}>Recipient Address</label>
      <input style={input} placeholder="1A1zP1..." value={address} onChange={e => setAddress(e.target.value)} />
      <label style={label}>Amount (MNEE, e.g. 1.50 = $1.50)</label>
      <input style={input} placeholder="1.00" type="number" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} />
      <button style={disabled ? buttonDisabled : button} disabled={disabled} onClick={handleSend}>
        {loading ? 'Sending...' : 'Send MNEE'}
      </button>
      {result && (
        <div style={successText}>
          {result.txid && <div>TXID: <span style={mono}>{result.txid}</span></div>}
          {result.ticketId && <div>Ticket: <span style={mono}>{result.ticketId}</span></div>}
        </div>
      )}
      {error && <div style={errorText}>{error}</div>}
    </div>
  )
}
