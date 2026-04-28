import { lockBsv, getLockData, unlockBsv, type LockData } from '@1sat/actions'
import { useState } from 'react'
import { card, heading, input, button, buttonDisabled, successText, errorText, label, mono } from './styles'
import { useLog } from './LogContext'
import { useOneSatContext } from './useActions'

export function LockBsv() {
  const ctx = useOneSatContext()
  const { log } = useLog()
  const [lockData, setLockData] = useState<LockData | null>(null)
  const [amount, setAmount] = useState('')
  const [blockHeight, setBlockHeight] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function handleGetLockData() {
    if (!ctx) return
    setLoading(true)
    setError(null)
    log('info', 'getLockData...')
    try {
      const res = await getLockData.execute(ctx, {})
      setLockData(res)
      log('success', `getLockData: ${res.totalLocked} locked, ${res.unlockable} unlockable, next unlock: ${res.nextUnlock}`)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(msg)
      log('error', `getLockData failed: ${msg}`)
    } finally {
      setLoading(false)
    }
  }

  async function handleLock() {
    if (!ctx || !amount || !blockHeight) return
    setLoading(true)
    setResult(null)
    setError(null)
    log('info', `lockBsv: ${amount} sat until block ${blockHeight}`)
    try {
      const res = await lockBsv.execute(ctx, {
        requests: [{ satoshis: Number(amount), until: Number(blockHeight) }],
      })
      if (res.error) throw new Error(res.error)
      setResult(res.txid ?? 'no txid')
      log('success', `lockBsv txid: ${res.txid}`)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(msg)
      log('error', `lockBsv failed: ${msg}`)
    } finally {
      setLoading(false)
    }
  }

  async function handleUnlock() {
    if (!ctx) return
    setLoading(true)
    setResult(null)
    setError(null)
    log('info', 'unlockBsv...')
    try {
      const res = await unlockBsv.execute(ctx, {})
      if (res.error) throw new Error(res.error)
      setResult(res.txid ?? 'no txid')
      log('success', `unlockBsv txid: ${res.txid}`)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(msg)
      log('error', `unlockBsv failed: ${msg}`)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={card}>
      <div style={heading}>Lock / Unlock BSV</div>

      <button
        style={!ctx || loading ? buttonDisabled : { ...button, marginBottom: '0.75rem' }}
        disabled={!ctx || loading}
        onClick={handleGetLockData}
      >
        Get Lock Data
      </button>

      {lockData && (
        <div style={{ ...mono, fontSize: '0.75rem', marginBottom: '0.75rem', color: '#888' }}>
          Locked: {lockData.totalLocked} sat | Unlockable: {lockData.unlockable} sat | Next: block {lockData.nextUnlock}
        </div>
      )}

      <label style={label}>Amount (satoshis)</label>
      <input style={input} placeholder="1000" type="number" value={amount} onChange={e => setAmount(e.target.value)} />
      <label style={label}>Lock Until Block Height</label>
      <input style={input} placeholder="900000" type="number" value={blockHeight} onChange={e => setBlockHeight(e.target.value)} />

      <div style={{ display: 'flex', gap: '0.5rem' }}>
        <button
          style={!ctx || loading || !amount || !blockHeight ? buttonDisabled : button}
          disabled={!ctx || loading || !amount || !blockHeight}
          onClick={handleLock}
        >
          {loading ? 'Locking...' : 'Lock BSV'}
        </button>
        <button
          style={!ctx || loading ? buttonDisabled : { ...button, background: '#7c3aed' }}
          disabled={!ctx || loading}
          onClick={handleUnlock}
        >
          Unlock Matured
        </button>
      </div>

      {result && <div style={successText}>TXID: {result}</div>}
      {error && <div style={errorText}>{error}</div>}
    </div>
  )
}
