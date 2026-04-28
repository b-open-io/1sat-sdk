import { sendBsv21 } from '@1sat/actions'
import { useState } from 'react'
import { card, heading, input, button, buttonDisabled, successText, errorText, label } from './styles'
import { useLog } from './LogContext'
import { useOneSatContext } from './useActions'

export function TransferToken() {
  const ctx = useOneSatContext()
  const { log } = useLog()
  const [tokenId, setTokenId] = useState('')
  const [amount, setAmount] = useState('')
  const [destAddress, setDestAddress] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const disabled = !ctx || loading || !tokenId || !amount || !destAddress

  async function handleTransfer() {
    if (!ctx || disabled) return
    setLoading(true)
    setResult(null)
    setError(null)
    log('info', `sendBsv21: ${amount} of ${tokenId} to ${destAddress}`)

    try {
      const res = await sendBsv21.execute(ctx, {
        tokenId,
        recipients: [{ amount, address: destAddress }],
      })

      if (res.error) throw new Error(res.error)
      setResult(res.txid ?? 'no txid')
      log('success', `sendBsv21 txid: ${res.txid}`)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(msg)
      log('error', `sendBsv21 failed: ${msg}`)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={card}>
      <div style={heading}>Transfer Token (BSV21)</div>
      <label style={label}>Token ID</label>
      <input style={input} placeholder="txid_vout" value={tokenId} onChange={e => setTokenId(e.target.value)} />
      <label style={label}>Amount</label>
      <input style={input} placeholder="100" value={amount} onChange={e => setAmount(e.target.value)} />
      <label style={label}>Destination Address</label>
      <input style={input} placeholder="1A1zP1..." value={destAddress} onChange={e => setDestAddress(e.target.value)} />
      <button style={disabled ? buttonDisabled : button} disabled={disabled} onClick={handleTransfer}>
        {loading ? 'Transferring...' : 'Transfer Token'}
      </button>
      {result && <div style={successText}>TXID: {result}</div>}
      {error && <div style={errorText}>{error}</div>}
    </div>
  )
}
