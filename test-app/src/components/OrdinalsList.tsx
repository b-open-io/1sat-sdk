import { getOrdinals, ONESAT_MAINNET_CONTENT_URL, type GetOrdinalsResult } from '@1sat/actions'
import { useEffect, useState } from 'react'
import { card, heading, button, buttonDisabled, errorText, mono } from './styles'
import { useLog } from './LogContext'
import { useOneSatContext } from './useActions'
import type { WalletOutput } from '@bsv/sdk'

/** Extract a tag value like "type:text/plain" → "text/plain" */
function getTagValue(tags: string[] | undefined, prefix: string): string | undefined {
  if (!tags) return undefined
  const tag = tags.find(t => t.startsWith(`${prefix}:`))
  return tag ? tag.slice(prefix.length + 1) : undefined
}

/** Resolve origin outpoint — bare "origin" tag means the output IS the origin */
function resolveOrigin(output: WalletOutput): string | undefined {
  const tagged = getTagValue(output.tags, 'origin')
  if (tagged) return tagged
  if (output.tags?.includes('origin')) return output.outpoint
  return undefined
}

function contentUrl(outpoint: string): string {
  return `${ONESAT_MAINNET_CONTENT_URL}/${outpoint}`
}

export function OrdinalsList() {
  const ctx = useOneSatContext()
  const { log } = useLog()
  const [result, setResult] = useState<GetOrdinalsResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const disabled = !ctx || loading

  async function handleFetch() {
    if (!ctx || disabled) return
    setLoading(true)
    setError(null)
    log('info', 'getOrdinals...')

    try {
      const res = await getOrdinals.execute(ctx, { limit: 50 })
      setResult(res)
      log('success', `getOrdinals: ${res.outputs.length} ordinal(s)${res.BEEF ? `, BEEF: ${res.BEEF.length} bytes` : ''}`)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(msg)
      log('error', `getOrdinals failed: ${msg}`)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={heading}>Ordinals</div>
        <button
          style={disabled ? buttonDisabled : { ...button, fontSize: '0.75rem', padding: '0.3rem 0.6rem' }}
          disabled={disabled}
          onClick={handleFetch}
        >
          {loading ? 'Loading...' : 'Refresh'}
        </button>
      </div>

      {!result && !error && (
        <p style={{ color: '#666', fontSize: '0.8rem' }}>
          {ctx ? 'Click Refresh' : 'Connect wallet first'}
        </p>
      )}

      <div style={{ maxHeight: '400px', overflow: 'auto' }}>
        {result?.outputs.map(ord => {
          const contentType = getTagValue(ord.tags, 'type')
          const origin = resolveOrigin(ord)
          const name = getTagValue(ord.tags, 'name')
          const previewUrl = origin ? contentUrl(origin) : undefined

          const isText = contentType?.startsWith('text/')
          const isHtml = contentType === 'text/html' || contentType === 'image/svg+xml'
          const isJson = contentType?.startsWith('application/json')

          return (
            <div key={ord.outpoint} style={ordItemStyle}>
              <div style={{ flex: 1, minWidth: 0 }}>
                {name && <div style={{ fontSize: '0.8rem', fontWeight: 600, color: '#e0e0e0' }}>{name}</div>}
                <div style={mono}>{ord.outpoint}</div>
                <div style={metaStyle}>
                  {contentType && <span style={badgeStyle}>{contentType}</span>}
                  <span>{ord.spendable ? 'spendable' : 'locked'}</span>
                  {origin && origin !== ord.outpoint && (
                    <span>origin: {origin.slice(0, 12)}...</span>
                  )}
                </div>

                {previewUrl && (
                  <div style={previewContainerStyle}>
                    {(isText || isJson) && !isHtml ? (
                      <TextPreview url={previewUrl} />
                    ) : (
                      <img
                        src={previewUrl}
                        alt={name ?? 'ordinal'}
                        style={previewImageStyle}
                      />
                    )}
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {error && <div style={errorText}>{error}</div>}
    </div>
  )
}

function TextPreview({ url }: { url: string }) {
  const [text, setText] = useState<string | null>(null)
  useEffect(() => {
    fetch(url)
      .then(r => r.text())
      .then(setText)
      .catch(() => setText(null))
  }, [url])
  if (text === null) return <div style={{ color: '#555', fontSize: '0.7rem' }}>Loading...</div>
  return <pre style={previewTextStyle}>{text.slice(0, 500)}{text.length > 500 ? '...' : ''}</pre>
}

const ordItemStyle: React.CSSProperties = {
  padding: '0.5rem',
  borderBottom: '1px solid #1a1a1a',
  fontSize: '0.8rem',
}

const metaStyle: React.CSSProperties = {
  color: '#888',
  fontSize: '0.7rem',
  display: 'flex',
  gap: '0.5rem',
  flexWrap: 'wrap',
  marginTop: '0.15rem',
}

const badgeStyle: React.CSSProperties = {
  background: '#2a2a2a',
  padding: '0.05rem 0.3rem',
  borderRadius: '3px',
  color: '#aaa',
}

const previewContainerStyle: React.CSSProperties = {
  marginTop: '0.35rem',
  borderRadius: '4px',
  overflow: 'hidden',
  background: '#1a1a1a',
}

const previewImageStyle: React.CSSProperties = {
  maxWidth: '100%',
  maxHeight: '150px',
  display: 'block',
}

const previewTextStyle: React.CSSProperties = {
  margin: 0,
  padding: '0.4rem',
  fontSize: '0.7rem',
  color: '#ccc',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-all',
  maxHeight: '120px',
  overflow: 'auto',
  fontFamily: 'monospace',
}
