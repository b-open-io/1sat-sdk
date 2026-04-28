import { getOrdinals, listOrdinal, purchaseOrdinal, cancelListing } from '@1sat/actions'
import { useState } from 'react'
import { card, heading, input, button, buttonDisabled, successText, errorText, label, row } from './styles'
import { useLog } from './LogContext'
import { useOneSatContext } from './useActions'

type Tab = 'create' | 'purchase' | 'cancel'

export function Listings() {
  const [tab, setTab] = useState<Tab>('create')

  return (
    <div style={card}>
      <div style={heading}>Marketplace Listings</div>
      <div style={{ ...row, marginBottom: '0.75rem' }}>
        {(['create', 'purchase', 'cancel'] as Tab[]).map(t => (
          <button
            key={t}
            style={{
              ...button,
              background: tab === t ? '#2563eb' : '#1a1a1a',
              border: '1px solid #333',
              fontSize: '0.75rem',
              padding: '0.35rem 0.75rem',
            }}
            onClick={() => setTab(t)}
          >
            {t === 'create' ? 'List' : t === 'purchase' ? 'Buy' : 'Cancel'}
          </button>
        ))}
      </div>
      {tab === 'create' && <CreateListing />}
      {tab === 'purchase' && <PurchaseListing />}
      {tab === 'cancel' && <CancelListing />}
    </div>
  )
}

function CreateListing() {
  const ctx = useOneSatContext()
  const { log } = useLog()
  const [outpoint, setOutpoint] = useState('')
  const [price, setPrice] = useState('')
  const [payAddress, setPayAddress] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const disabled = !ctx || loading || !outpoint || !price || !payAddress

  async function handleList() {
    if (!ctx || disabled) return
    setLoading(true)
    setResult(null)
    setError(null)
    log('info', `listOrdinal: ${outpoint} for ${price} sat`)

    try {
      const ordsResult = await getOrdinals.execute(ctx, {})
      const ordinal = ordsResult.outputs.find(o => o.outpoint === outpoint)
      if (!ordinal) throw new Error(`Outpoint ${outpoint} not found`)
      if (!ordsResult.BEEF) throw new Error('No BEEF from getOrdinals')

      const res = await listOrdinal.execute(ctx, {
        ordinal,
        inputBEEF: Array.from(ordsResult.BEEF),
        price: Number(price),
        payAddress,
      })

      if (res.error) throw new Error(res.error)
      setResult(res.txid ?? 'no txid')
      log('success', `listOrdinal txid: ${res.txid}`)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(msg)
      log('error', `listOrdinal failed: ${msg}`)
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <label style={label}>Ordinal Outpoint (txid.vout)</label>
      <input style={input} placeholder="abc...def.0" value={outpoint} onChange={e => setOutpoint(e.target.value)} />
      <label style={label}>Price (satoshis)</label>
      <input style={input} placeholder="10000" type="number" value={price} onChange={e => setPrice(e.target.value)} />
      <label style={label}>Payment Address (receives sale proceeds)</label>
      <input style={input} placeholder="Your payment address" value={payAddress} onChange={e => setPayAddress(e.target.value)} />
      <button style={disabled ? buttonDisabled : button} disabled={disabled} onClick={handleList}>
        {loading ? 'Listing...' : 'Create Listing'}
      </button>
      {result && <div style={successText}>TXID: {result}</div>}
      {error && <div style={errorText}>{error}</div>}
    </>
  )
}

function PurchaseListing() {
  const ctx = useOneSatContext()
  const { log } = useLog()
  const [listingOutpoint, setListingOutpoint] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const disabled = !ctx || loading || !listingOutpoint

  async function handlePurchase() {
    if (!ctx || disabled) return
    setLoading(true)
    setResult(null)
    setError(null)
    log('info', `purchaseOrdinal: ${listingOutpoint}`)

    try {
      const res = await purchaseOrdinal.execute(ctx, {
        outpoint: listingOutpoint,
      })

      if (res.error) throw new Error(res.error)
      setResult(res.txid ?? 'no txid')
      log('success', `purchaseOrdinal txid: ${res.txid}`)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(msg)
      log('error', `purchaseOrdinal failed: ${msg}`)
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <label style={label}>Listing Outpoint (txid.vout)</label>
      <input style={input} placeholder="abc...def.0" value={listingOutpoint} onChange={e => setListingOutpoint(e.target.value)} />
      <button style={disabled ? buttonDisabled : button} disabled={disabled} onClick={handlePurchase}>
        {loading ? 'Purchasing...' : 'Purchase Listing'}
      </button>
      {result && <div style={successText}>TXID: {result}</div>}
      {error && <div style={errorText}>{error}</div>}
    </>
  )
}

function CancelListing() {
  const ctx = useOneSatContext()
  const { log } = useLog()
  const [listingOutpoint, setListingOutpoint] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const disabled = !ctx || loading || !listingOutpoint

  async function handleCancel() {
    if (!ctx || disabled) return
    setLoading(true)
    setResult(null)
    setError(null)
    log('info', `cancelListing: ${listingOutpoint}`)

    try {
      // Need to get the listing output with its locking script and BEEF
      const ordsResult = await getOrdinals.execute(ctx, {})
      const listing = ordsResult.outputs.find(o => o.outpoint === listingOutpoint)
      if (!listing) throw new Error(`Listing ${listingOutpoint} not found`)
      if (!ordsResult.BEEF) throw new Error('No BEEF from getOrdinals')

      const res = await cancelListing.execute(ctx, {
        listing,
        inputBEEF: Array.from(ordsResult.BEEF),
      })

      if (res.error) throw new Error(res.error)
      setResult(res.txid ?? 'no txid')
      log('success', `cancelListing txid: ${res.txid}`)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(msg)
      log('error', `cancelListing failed: ${msg}`)
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <label style={label}>Listing Outpoint (txid.vout)</label>
      <input style={input} placeholder="abc...def.0" value={listingOutpoint} onChange={e => setListingOutpoint(e.target.value)} />
      <button style={disabled ? buttonDisabled : button} disabled={disabled} onClick={handleCancel}>
        {loading ? 'Cancelling...' : 'Cancel Listing'}
      </button>
      {result && <div style={successText}>TXID: {result}</div>}
      {error && <div style={errorText}>{error}</div>}
    </>
  )
}
