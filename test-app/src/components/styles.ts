import type { CSSProperties } from 'react'

export const card: CSSProperties = {
  background: '#141414',
  border: '1px solid #2a2a2a',
  borderRadius: '8px',
  padding: '1rem',
}

export const heading: CSSProperties = {
  fontSize: '0.875rem',
  fontWeight: 600,
  textTransform: 'uppercase' as const,
  letterSpacing: '0.05em',
  color: '#888',
  marginBottom: '0.75rem',
}

export const input: CSSProperties = {
  width: '100%',
  padding: '0.5rem 0.75rem',
  background: '#1a1a1a',
  border: '1px solid #333',
  borderRadius: '6px',
  color: '#e0e0e0',
  fontSize: '0.875rem',
  marginBottom: '0.5rem',
}

export const button: CSSProperties = {
  padding: '0.5rem 1rem',
  background: '#2563eb',
  color: '#fff',
  border: 'none',
  borderRadius: '6px',
  cursor: 'pointer',
  fontSize: '0.875rem',
  fontWeight: 500,
}

export const buttonDisabled: CSSProperties = {
  ...button,
  opacity: 0.5,
  cursor: 'not-allowed',
}

export const successText: CSSProperties = {
  color: '#22c55e',
  fontSize: '0.8rem',
  marginTop: '0.5rem',
  wordBreak: 'break-all',
}

export const errorText: CSSProperties = {
  color: '#ef4444',
  fontSize: '0.8rem',
  marginTop: '0.5rem',
  wordBreak: 'break-all',
}

export const mono: CSSProperties = {
  fontFamily: 'monospace',
  fontSize: '0.8rem',
  wordBreak: 'break-all',
}

export const label: CSSProperties = {
  fontSize: '0.8rem',
  color: '#888',
  marginBottom: '0.25rem',
  display: 'block',
}

export const row: CSSProperties = {
  display: 'flex',
  gap: '0.5rem',
  alignItems: 'center',
}
