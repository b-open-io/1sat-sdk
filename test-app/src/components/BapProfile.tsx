import { getProfile, type ProfileResponse } from '@1sat/actions'
import { useState } from 'react'
import { card, heading, button, buttonDisabled, errorText, mono } from './styles'
import { useLog } from './LogContext'
import { useOneSatContext } from './useActions'

export function BapProfile() {
  const ctx = useOneSatContext()
  const { log } = useLog()
  const [profile, setProfile] = useState<ProfileResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const disabled = !ctx || loading

  async function handleGetProfile() {
    if (!ctx) return
    setLoading(true)
    setError(null)
    log('info', 'getProfile...')

    try {
      const res = await getProfile.execute(ctx, {})
      if (res.error) throw new Error(res.error)
      setProfile(res)
      log('success', `getProfile: bapId=${res.bapId ?? 'none'}, profile=${JSON.stringify(res.profile ?? {})}`)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(msg)
      log('error', `getProfile failed: ${msg}`)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={card}>
      <div style={heading}>BAP Identity</div>
      <button style={disabled ? buttonDisabled : button} disabled={disabled} onClick={handleGetProfile}>
        {loading ? 'Loading...' : 'Get Profile'}
      </button>

      {profile && (
        <div style={{ marginTop: '0.5rem' }}>
          {profile.bapId && (
            <div style={{ fontSize: '0.75rem', color: '#888', marginBottom: '0.25rem' }}>
              BAP ID: <span style={mono}>{profile.bapId}</span>
            </div>
          )}
          {profile.profile ? (
            <pre style={{ ...mono, fontSize: '0.7rem', whiteSpace: 'pre-wrap', wordBreak: 'break-all', color: '#ccc', margin: 0 }}>
              {JSON.stringify(profile.profile, null, 2)}
            </pre>
          ) : (
            <div style={{ fontSize: '0.75rem', color: '#666' }}>No profile published yet</div>
          )}
        </div>
      )}

      {error && <div style={errorText}>{error}</div>}
    </div>
  )
}
