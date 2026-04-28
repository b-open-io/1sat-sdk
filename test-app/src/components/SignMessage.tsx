import { signBsm } from '@1sat/actions'
import { useState } from 'react'
import { card, heading, input, button, buttonDisabled, successText, errorText, label, mono } from './styles'
import { useLog } from './LogContext'
import { useOneSatContext } from './useActions'

export function SignMessage() {
  const ctx = useOneSatContext()
  const { log } = useLog()
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<{ sig: string; address: string; pubKey: string } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const disabled = !ctx || loading || !message

  async function handleSign() {
    if (!ctx || disabled) return
    setLoading(true)
    setResult(null)
    setError(null)
    log('info', `signBsm: "${message.slice(0, 40)}${message.length > 40 ? '...' : ''}"`)

    try {
      const res = await signBsm.execute(ctx, { message })

      if (res.error) throw new Error(res.error)
      setResult({ sig: res.sig!, address: res.address!, pubKey: res.pubKey! })
      log('success', `signBsm: signed by ${res.address}`)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(msg)
      log('error', `signBsm failed: ${msg}`)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={card}>
      <div style={heading}>Sign Message (BSM)</div>
      <label style={label}>Message</label>
      <input style={input} placeholder="Hello, world!" value={message} onChange={e => setMessage(e.target.value)} />
      <button style={disabled ? buttonDisabled : button} disabled={disabled} onClick={handleSign}>
        {loading ? 'Signing...' : 'Sign Message'}
      </button>
      {result && (
        <div style={successText}>
          <div>Address: <span style={mono}>{result.address}</span></div>
          <div>PubKey: <span style={mono}>{result.pubKey}</span></div>
          <div>Sig: <span style={mono}>{result.sig}</span></div>
        </div>
      )}
      {error && <div style={errorText}>{error}</div>}
    </div>
  )
}
