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
	/** When present, render as a featured asset card (NFT image). */
	featured?: {
		imageUrl: string
		title: string
		subtitle?: string
	}
}

interface AssetEntry {
	basket: string
	id: string
	outpoint: string
	satoshis: number
	tags: string[]
}

interface OutputEntry {
	index: number
	satoshis: number
	basket?: string
	tags: string[]
	recipient?: string
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

			{summary.featured && (
				<div className="opp-featured">
					<img
						className="opp-featured-image"
						src={summary.featured.imageUrl}
						alt={summary.featured.title}
					/>
					<div className="opp-featured-meta">
						<div className="opp-featured-title">{summary.featured.title}</div>
						{summary.featured.subtitle && (
							<div className="opp-featured-subtitle">
								{summary.featured.subtitle}
							</div>
						)}
					</div>
				</div>
			)}

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
		const intent = req.intent as unknown as TransactionIntent
		switch (intent.kind) {
			case 'ordinal-transfer':
				return summarizeOrdinalTransfer(req, intent)
			case 'token-transfer':
				return summarizeTokenTransfer(req, intent)
			case 'lock':
				return summarizeLock(req, intent)
			case 'unlock':
				return summarizeUnlock(req, intent)
			case 'inscription':
				return summarizeInscription(req, intent)
			case 'social-post':
				return summarizeSocialPost(req, intent)
			default:
				return summarizeUnknownTx(req, intent)
		}
	}
	if (req.kind === 'protocol') {
		return summarizeProtocol(req)
	}
	return summarizeSignature(req)
}

interface TransactionIntent {
	kind:
		| 'ordinal-transfer'
		| 'token-transfer'
		| 'lock'
		| 'unlock'
		| 'inscription'
		| 'social-post'
		| 'opns'
		| 'unknown'
	inputs: AssetEntry[]
	outputs: OutputEntry[]
	contentUrls?: Record<string, string>
	chain?: string
}

function tagValue(tags: string[] | undefined, key: string): string | undefined {
	if (!tags) return undefined
	const prefix = `${key}:`
	for (const t of tags) {
		if (t.startsWith(prefix)) return t.slice(prefix.length)
	}
	return undefined
}

function summarizeOrdinalTransfer(
	req: PromptRequest,
	intent: TransactionIntent,
): IntentSummary {
	const ordinal = intent.inputs[0]
	const origin = tagValue(ordinal?.tags, 'origin')
	const name = tagValue(ordinal?.tags, 'name')
	const contentType = tagValue(ordinal?.tags, 'type')
	const collectionId = tagValue(ordinal?.tags, 'collectionId')
	const recipient = intent.outputs.find((o) => o.recipient)?.recipient
	const imageUrl = ordinal && intent.contentUrls?.[ordinal.id]

	const rows: DetailRow[] = []
	if (recipient) rows.push({ key: 'Recipient', value: recipient })
	if (origin) rows.push({ key: 'Origin', value: origin })
	if (contentType) rows.push({ key: 'Type', value: contentType })

	return {
		title: 'NFT Transfer',
		subtitle: `${shortenOriginator(req.originator)} wants to transfer an ordinal`,
		rows,
		featured: imageUrl
			? {
					imageUrl,
					title: name ?? 'Untitled ordinal',
					subtitle: collectionId ?? contentType,
				}
			: undefined,
		network: networkLabel(intent.chain),
	}
}

function summarizeTokenTransfer(
	req: PromptRequest,
	intent: TransactionIntent,
): IntentSummary {
	// Token inputs of the same id are consolidated for display.
	const totals = new Map<string, { sym?: string; amt: bigint }>()
	for (const input of intent.inputs) {
		const tokenId = tagValue(input.tags, 'bsv21')
		if (!tokenId) continue
		const sym = tagValue(input.tags, 'sym')
		const amt = BigInt(tagValue(input.tags, 'amt') ?? '0')
		const cur = totals.get(tokenId) ?? { sym, amt: 0n }
		cur.amt += amt
		if (!cur.sym && sym) cur.sym = sym
		totals.set(tokenId, cur)
	}

	const rows: DetailRow[] = []
	for (const [tokenId, info] of totals) {
		rows.push({
			key: 'Token',
			value: info.sym ? `${info.sym} — ${shortenId(tokenId)}` : shortenId(tokenId),
		})
		rows.push({ key: 'Amount', value: info.amt.toString() })
	}
	const recipient = intent.outputs.find((o) => o.recipient)?.recipient
	if (recipient) rows.push({ key: 'Recipient', value: recipient })

	return {
		title: 'Token Transfer',
		subtitle: `${shortenOriginator(req.originator)} wants to send tokens`,
		rows,
		network: networkLabel(intent.chain),
	}
}

function summarizeLock(
	req: PromptRequest,
	intent: TransactionIntent,
): IntentSummary {
	const sats = intent.outputs.reduce((s, o) => s + o.satoshis, 0)
	const until = intent.outputs
		.flatMap((o) => o.tags)
		.find((t) => t.startsWith('lock:until:'))
		?.slice('lock:until:'.length)
	const rows: DetailRow[] = [{ key: 'Amount', value: `${sats} sats` }]
	if (until) rows.push({ key: 'Lock until block', value: until })
	return {
		title: 'Lock BSV',
		subtitle: `${shortenOriginator(req.originator)} wants to time-lock funds`,
		rows,
		network: networkLabel(intent.chain),
	}
}

function summarizeUnlock(
	req: PromptRequest,
	intent: TransactionIntent,
): IntentSummary {
	const sats = intent.inputs.reduce((s, i) => s + i.satoshis, 0)
	return {
		title: 'Unlock Matured',
		subtitle: `${shortenOriginator(req.originator)} wants to unlock matured locks`,
		rows: [{ key: 'Amount', value: `${sats} sats` }],
		network: networkLabel(intent.chain),
	}
}

function summarizeInscription(
	req: PromptRequest,
	intent: TransactionIntent,
): IntentSummary {
	const recipient = intent.outputs.find((o) => o.recipient)?.recipient
	const rows: DetailRow[] = []
	if (recipient) rows.push({ key: 'Recipient', value: recipient })
	return {
		title: 'Create Inscription',
		subtitle: `${shortenOriginator(req.originator)} wants to inscribe content`,
		rows,
		network: networkLabel(intent.chain),
	}
}

function summarizeSocialPost(
	req: PromptRequest,
	intent: TransactionIntent,
): IntentSummary {
	return {
		title: 'Social Post',
		subtitle: `${shortenOriginator(req.originator)} wants to publish a post`,
		rows: [],
		network: networkLabel(intent.chain),
	}
}

function summarizeUnknownTx(
	req: PromptRequest,
	intent: TransactionIntent,
): IntentSummary {
	const ins = intent.inputs.length
	const outs = intent.outputs.length
	return {
		title: 'Transaction Request',
		subtitle: `${shortenOriginator(req.originator)} wants to ${req.summary.toLowerCase()}`,
		rows: [{ key: 'Inputs / Outputs', value: `${ins} / ${outs}` }],
		network: networkLabel(intent.chain),
	}
}

function networkLabel(chain?: string): string {
	return chain === 'testnet' ? 'BSV Testnet' : 'BSV Mainnet'
}

function shortenId(id: string, max = 24): string {
	if (id.length <= max) return id
	return `${id.slice(0, 8)}…${id.slice(-6)}`
}

function summarizeProtocol(req: PromptRequest): IntentSummary {
	const intent = req.intent as {
		protocolID?: unknown
		access?: string
		notes?: string
	}
	const rows: DetailRow[] = [
		{ key: 'Protocol', value: '1Sat (p 1sat)' },
		{ key: 'Access', value: (intent.access as string) ?? 'read-only' },
	]
	return {
		title: 'Protocol Access',
		subtitle:
			intent.notes ??
			`${shortenOriginator(req.originator)} requests read-only access to derive your 1Sat addresses. Signing remains per-transaction.`,
		rows,
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
