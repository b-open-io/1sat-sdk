import { inscribe } from '@1sat/actions'
import { Utils } from '@bsv/sdk'
import { useState } from 'react'
import { card, heading, input, button, buttonDisabled, successText, errorText, label } from './styles'
import { useLog } from './LogContext'
import { useOneSatContext } from './useActions'

export function Inscribe() {
  const ctx = useOneSatContext()
  const { log } = useLog()
  const [text, setText] = useState('')
  const [contentType, setContentType] = useState('text/plain')
  const [file, setFile] = useState<File | null>(null)
  const [signWithBAP, setSignWithBAP] = useState(false)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const disabled = !ctx || loading || (!text && !file)

  async function handleInscribe() {
    if (!ctx || disabled) return
    setLoading(true)
    setResult(null)
    setError(null)

    try {
      let base64Content: string
      let mime: string

      if (file) {
        const buffer = await file.arrayBuffer()
        base64Content = Utils.toBase64(Array.from(new Uint8Array(buffer)))
        mime = file.type || 'application/octet-stream'
        log('info', `inscribe: file ${file.name} (${mime}, ${buffer.byteLength} bytes)`)
      } else {
        base64Content = Utils.toBase64(Utils.toArray(text, 'utf8'))
        mime = contentType
        log('info', `inscribe: text (${mime}, ${text.length} chars)`)
      }
      log('info', signWithBAP ? 'intent: ordinal.inscribe-sigma' : 'intent: ordinal.inscribe')

      const res = await inscribe.execute(ctx, {
        base64Content,
        contentType: mime,
        signWithBAP,
      })

      if (res.error) throw new Error(res.error)
      setResult(res.txid ?? 'no txid')
      log('success', `inscribe txid: ${res.txid}`)
      setText('')
      setFile(null)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(msg)
      log('error', `inscribe failed: ${msg}`)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={card}>
      <div style={heading}>Inscribe</div>

      <label style={label}>Text Content</label>
      <textarea
        style={{ ...input, minHeight: '4rem', resize: 'vertical' }}
        placeholder="Enter text to inscribe..."
        value={text}
        onChange={e => setText(e.target.value)}
      />

      <label style={label}>Content Type</label>
      <select style={input} value={contentType} onChange={e => setContentType(e.target.value)}>
        <option value="text/plain">text/plain</option>
        <option value="text/html">text/html</option>
        <option value="application/json">application/json</option>
        <option value="image/png">image/png</option>
        <option value="image/jpeg">image/jpeg</option>
        <option value="image/svg+xml">image/svg+xml</option>
      </select>

      <label style={label}>Or Upload File</label>
      <input
        type="file"
        style={{ ...input, padding: '0.25rem' }}
        onChange={e => { if (e.target.files?.[0]) setFile(e.target.files[0]) }}
      />

      <label style={{ ...label, display: 'flex', alignItems: 'center', gap: '0.4rem', margin: '0.25rem 0 0.6rem' }}>
        <input
          type="checkbox"
          checked={signWithBAP}
          onChange={e => setSignWithBAP(e.target.checked)}
        />
        Sign with BAP (Sigma) — intent {signWithBAP ? 'ordinal.inscribe-sigma' : 'ordinal.inscribe'}
      </label>

      <button style={disabled ? buttonDisabled : button} disabled={disabled} onClick={handleInscribe}>
        {loading ? 'Inscribing...' : 'Inscribe'}
      </button>
      {result && <div style={successText}>TXID: {result}</div>}
      {error && <div style={errorText}>{error}</div>}
    </div>
  )
}
