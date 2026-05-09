'use client'

import type { PromptRequest } from '@1sat/permission-module'
import { useEffect, useState } from 'react'
import { promptStyles } from './styles'

export type Theme = 'light' | 'dark' | 'auto'

export interface OneSatPermissionPromptProps {
	/** The structured request handed to the wallet's promptHandler. */
	request: PromptRequest
	/** Called when the user approves. The host wallet resolves promptHandler with `true`. */
	onApprove: () => void
	/** Called when the user rejects. The host wallet resolves promptHandler with `false`. */
	onReject: () => void
	/** Theme override. Defaults to 'auto' (matches `prefers-color-scheme`). */
	theme?: Theme
	/** App name shown in the header. Defaults to '1Sat Ordinals'. */
	appName?: string
	/** Version string shown in the footer (e.g. wallet version). */
	version?: string
}

interface DetailRow {
	key: string
	value: string
}

interface IntentSummary {
	title: string
	subtitle: string
	rows: DetailRow[]
	feeSats?: number
	network?: string
}

/**
 * Drop-in component for rendering 1Sat permission prompts.
 *
 * The host wallet feeds in the `request` it received from its promptHandler
 * callback and wires `onApprove`/`onReject` to resolve the same Promise.
 * Layout mirrors the design in `1sat-permissions-popups.pen` — branding
 * header, intent title, asset detail card, network/fee, approve/reject.
 */
export function OneSatPermissionPrompt({
	request,
	onApprove,
	onReject,
	theme = 'auto',
	appName = '1Sat Ordinals',
	version,
}: OneSatPermissionPromptProps) {
	const resolvedTheme = useResolvedTheme(theme)
	const summary = summarizeRequest(request)
	const [busy, setBusy] = useState(false)

	const handle = (action: 'approve' | 'reject') => () => {
		if (busy) return
		setBusy(true)
		try {
			if (action === 'approve') onApprove()
			else onReject()
		} finally {
			setBusy(false)
		}
	}

	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.key === 'Escape') onReject()
			else if (e.key === 'Enter') onApprove()
		}
		window.addEventListener('keydown', onKey)
		return () => window.removeEventListener('keydown', onKey)
	}, [onApprove, onReject])

	const className = `opp-root${resolvedTheme === 'dark' ? ' opp-dark' : ''}`

	return (
		<div className={className}>
			<style>{promptStyles}</style>

			<div className="opp-header">
				<div className="opp-header-brand">
					<div className="opp-avatar">1</div>
					<span>{appName}</span>
				</div>
				<div className="opp-header-app">
					<div className="opp-avatar opp-app">
						{originatorInitial(request.originator)}
					</div>
					<span>{shortenOriginator(request.originator)}</span>
				</div>
			</div>

			<div className="opp-body">
				<div className="opp-icon" aria-hidden="true">
					🛡
				</div>
				<h2 className="opp-title">{summary.title}</h2>
				<p className="opp-subtitle">{summary.subtitle}</p>
				<div className="opp-status">Awaiting Approval</div>
			</div>

			{summary.rows.length > 0 && (
				<div className="opp-card">
					{summary.rows.map((row) => (
						<div className="opp-row" key={`${row.key}:${row.value}`}>
							<span className="opp-row-key">{row.key}</span>
							<span className="opp-row-value">{row.value}</span>
						</div>
					))}
				</div>
			)}

			{(summary.network || summary.feeSats !== undefined) && (
				<div className="opp-meta">
					{summary.network && (
						<span>
							Network <span className="opp-meta-value">{summary.network}</span>
						</span>
					)}
					{summary.feeSats !== undefined && (
						<span>
							Estimated Fee{' '}
							<span className="opp-meta-value">{summary.feeSats} sats</span>
						</span>
					)}
				</div>
			)}

			<div className="opp-actions">
				<button
					type="button"
					className="opp-button opp-button-reject"
					onClick={handle('reject')}
					disabled={busy}
				>
					Reject
				</button>
				<button
					type="button"
					className="opp-button opp-button-approve"
					onClick={handle('approve')}
					disabled={busy}
				>
					Approve
				</button>
			</div>

			<div className="opp-footer">
				<span>Secured by {appName}</span>
				{version && <span>v{version}</span>}
			</div>
		</div>
	)
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function useResolvedTheme(theme: Theme): 'light' | 'dark' {
	const [resolved, setResolved] = useState<'light' | 'dark'>(() =>
		theme === 'auto' ? readSystemTheme() : theme,
	)
	useEffect(() => {
		if (theme !== 'auto') {
			setResolved(theme)
			return
		}
		const mq = window.matchMedia('(prefers-color-scheme: dark)')
		const sync = () => setResolved(mq.matches ? 'dark' : 'light')
		sync()
		mq.addEventListener('change', sync)
		return () => mq.removeEventListener('change', sync)
	}, [theme])
	return resolved
}

function readSystemTheme(): 'light' | 'dark' {
	if (typeof window === 'undefined' || !window.matchMedia) return 'light'
	return window.matchMedia('(prefers-color-scheme: dark)').matches
		? 'dark'
		: 'light'
}

function summarizeRequest(req: PromptRequest): IntentSummary {
	if (req.kind === 'transaction') {
		return summarizeTransaction(req)
	}
	return summarizeSignature(req)
}

function summarizeTransaction(req: PromptRequest): IntentSummary {
	const intent = req.intent as {
		description?: string
		inputs?: Array<{ outpoint?: string; inputDescription?: string }>
		outputs?: Array<{
			satoshis: number
			outputDescription?: string
			basket?: string
		}>
	}
	const rows: DetailRow[] = []
	let totalSats = 0
	for (const out of intent.outputs ?? []) {
		totalSats += out.satoshis ?? 0
		if (out.outputDescription) {
			rows.push({
				key: out.outputDescription,
				value: `${out.satoshis ?? 0} sats`,
			})
		}
	}
	if (rows.length === 0 && totalSats > 0) {
		rows.push({ key: 'Total Out', value: `${totalSats} sats` })
	}
	return {
		title: 'Transaction Request',
		subtitle: `${shortenOriginator(req.originator)} wants to ${req.summary.toLowerCase()}`,
		rows,
		network: 'BSV Mainnet',
	}
}

function summarizeSignature(req: PromptRequest): IntentSummary {
	const intent = req.intent as {
		protocolID?: unknown
		keyID?: string
		counterparty?: string
		dataLength?: number
	}
	const rows: DetailRow[] = []
	if (intent.protocolID) {
		rows.push({ key: 'Protocol', value: JSON.stringify(intent.protocolID) })
	}
	if (intent.keyID) rows.push({ key: 'Key ID', value: intent.keyID })
	if (intent.counterparty) {
		rows.push({
			key: 'Counterparty',
			value: shortenOriginator(intent.counterparty),
		})
	}
	if (typeof intent.dataLength === 'number') {
		rows.push({ key: 'Payload', value: `${intent.dataLength} bytes` })
	}
	return {
		title: 'Signature Request',
		subtitle: `${shortenOriginator(req.originator)} requests a signature`,
		rows,
	}
}

function shortenOriginator(origin: string): string {
	if (origin.length <= 28) return origin
	return `${origin.slice(0, 18)}…${origin.slice(-6)}`
}

function originatorInitial(origin: string): string {
	const cleaned = origin.replace(/^https?:\/\//, '')
	const first = cleaned[0]
	return first ? first.toUpperCase() : '?'
}
