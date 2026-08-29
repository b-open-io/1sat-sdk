'use client'

import {
	type EnrichedAsset,
	type EnrichedOutput,
	type PromptPanel,
	type PromptRequest,
	type TransactionPrompt,
	type VerificationResult,
	type VerificationServices,
	isTransactionPrompt,
	verifyIntent,
} from '@1sat/permission-module'
import { useEffect, useState } from 'react'
import { promptStyles } from './styles'

export type Theme = 'light' | 'dark' | 'auto'

export interface OneSatPermissionPromptProps {
	/** Structured request from the wallet's promptHandler. */
	request: PromptRequest
	onApprove: () => void
	onReject: () => void
	theme?: Theme
	/**
	 * Live verification clients (purchase trust upgrade). Host-supplied because
	 * the request may have crossed a process boundary.
	 */
	services?: VerificationServices
}

/**
 * Renders a {@link TransactionPrompt} (or simple non-tx prompts).
 * Does not classify scripts/tags — the permission module already did that.
 */
export function OneSatPermissionPrompt({
	request,
	onApprove,
	onReject,
	theme = 'auto',
	services,
}: OneSatPermissionPromptProps) {
	const resolvedTheme = useResolvedTheme(theme)
	const base = viewFromRequest(request)
	const [busy, setBusy] = useState(false)
	const [verified, setVerified] = useState<VerificationResult | undefined>()

	const txPrompt =
		request.kind === 'transaction' && isTransactionPrompt(request.payload)
			? request.payload
			: undefined

	useEffect(() => {
		if (!services || !txPrompt?.trust || !txPrompt.verify) return
		let live = true
		const getContentUrl = services.ordfs?.getContentUrl?.bind(services.ordfs)
		verifyIntent(
			services,
			txPrompt.verify.kind,
			txPrompt.verify.inputs as EnrichedAsset[],
			txPrompt.verify.outputs as EnrichedOutput[],
			getContentUrl,
		)
			.then((res) => {
				if (live && res) setVerified(res)
			})
			.catch(() => undefined)
		return () => {
			live = false
		}
	}, [services, txPrompt])

	const view = verified ? applyVerification(base, verified) : base

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
			if (busy) return
			if (e.key === 'Escape') onReject()
			else if (e.key === 'Enter') onApprove()
		}
		window.addEventListener('keydown', onKey)
		return () => window.removeEventListener('keydown', onKey)
	}, [onApprove, onReject, busy])

	const className = `opp-root${resolvedTheme === 'dark' ? ' opp-dark' : ''}`

	return (
		<div className={className}>
			<style>{promptStyles}</style>

			<div className="opp-body">
				<svg
					className="opp-coin"
					viewBox="0 0 100 100"
					aria-label="1Sat Ordinals"
				>
					<circle cx="50" cy="50" r="50" fill="#222" />
					<circle cx="50" cy="50" r="40" fill="#fff" />
					<circle cx="50" cy="50" r="32" fill="#E5A920" />
					<rect x="47" y="28" width="6" height="28" rx="3" fill="#fff" />
				</svg>
				<h2 className="opp-title">{view.title}</h2>
				<p className="opp-subtitle">{view.subtitle}</p>
				<div className="opp-status">Awaiting Approval</div>
			</div>

			{view.panels.map((panel, i) => {
				const variant = panel.variant ?? 'ordinal'
				const classes = ['opp-featured']
				if (variant === 'token') classes.push('opp-featured-token')
				if (variant === 'value') classes.push('opp-featured-value')
				if (panel.tone === 'danger') classes.push('opp-featured-danger')
				return (
					<div
						className={classes.join(' ')}
						key={`panel-${i}-${panel.title}`}
					>
						{panel.prior ? (
						<div className="opp-preview-pair" aria-label="Previous and new inscription">
							<PanelPreview
								panel={{
									...panel,
									previewKind: panel.prior.previewKind,
									imageUrl: panel.prior.imageUrl,
									contentUrl: panel.prior.contentUrl,
									previewText: panel.prior.previewText,
									prior: undefined,
								}}
							/>
							<span className="opp-preview-arrow" aria-hidden>
								→
							</span>
							<PanelPreview panel={panel} />
						</div>
					) : (
						<PanelPreview panel={panel} />
					)}
						<div className="opp-featured-meta">
							<div className="opp-featured-title">{panel.title}</div>
							{panel.subtitle && (
								<div className="opp-featured-subtitle">
									<span
										className={
											panel.amountSats != null
												? 'opp-featured-subtitle-text opp-amount'
												: 'opp-featured-subtitle-text'
										}
									>
										{panel.subtitle}
									</span>
									{panel.subtitleCopy && (
										<CopyButton text={panel.subtitleCopy} />
									)}
								</div>
							)}
							{(panel.meta ?? []).map((m) => (
								<div
									className={`opp-featured-meta-line${m.key ? '' : ' opp-featured-meta-line-bare'}`}
									key={`${m.key}:${m.value}`}
								>
									{m.key ? (
										<span className="opp-featured-meta-key">{m.key}</span>
									) : null}
									<span
										className={`opp-featured-meta-value${m.key ? '' : ' opp-featured-meta-value-mono'}`}
										title={m.copyValue ?? m.value}
									>
										{m.value}
									</span>
									{m.copyValue && <CopyButton text={m.copyValue} />}
								</div>
							))}
						</div>
					</div>
				)
			})}

			{view.trust && (
				<div className="opp-trust-wrap">
					<span className={`opp-trust opp-trust-${view.trust.state}`}>
						{trustLabel(view.trust.state)}
					</span>
					{view.trust.note && (
						<div className={`opp-trust-note opp-trust-note-${view.trust.state}`}>
							{view.trust.note}
						</div>
					)}
				</div>
			)}

			{(view.rows.length > 0 || view.indexerFee || view.funding) && (
				<div className="opp-card">
					{view.rows.map((row) => (
						<div className="opp-row" key={`${row.key}:${row.value}`}>
							<span className="opp-row-key">{row.key}</span>
							<span className="opp-row-value-wrap">
								<span
									className="opp-row-value"
									title={row.copyValue ?? row.value}
								>
									{row.value}
								</span>
								{row.copyValue && <CopyButton text={row.copyValue} />}
							</span>
						</div>
					))}
					{view.indexerFee && (
						<div className="opp-row">
							<span className="opp-row-key">1Sat Overlay Fee</span>
							<span className="opp-row-value opp-amount">
								{formatSats(view.indexerFee.sats)} sats
							</span>
						</div>
					)}
					{view.funding?.networkFeeSats != null && (
						<div className="opp-row">
							<span className="opp-row-key">Network fee</span>
							<span className="opp-row-value opp-amount">
								{formatSats(view.funding.networkFeeSats)} sats
							</span>
						</div>
					)}
					{view.funding?.note && (
						<div className="opp-fee-note">{view.funding.note}</div>
					)}
				</div>
			)}

			<div className="opp-bottom">
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
					<span>Secured by 1Sat Ordinals</span>
				</div>
			</div>
		</div>
	)
}

// ---------------------------------------------------------------------------
// View model (render-only)
// ---------------------------------------------------------------------------

interface ViewModel {
	title: string
	subtitle: string
	panels: PromptPanel[]
	rows: TransactionPrompt['rows']
	trust?: TransactionPrompt['trust']
	indexerFee?: TransactionPrompt['indexerFee']
	funding?: TransactionPrompt['funding']
}

function viewFromRequest(req: PromptRequest): ViewModel {
	if (req.kind === 'transaction' && isTransactionPrompt(req.payload)) {
		return {
			title: req.payload.title,
			subtitle: req.payload.subtitle,
			panels: req.payload.panels,
			rows: req.payload.rows,
			trust: req.payload.trust,
			indexerFee: req.payload.indexerFee,
			funding: req.payload.funding,
		}
	}

	if (req.kind === 'basketAccess') {
		const baskets =
			(
				req.payload as {
					baskets?: Array<{
						basket: string
						description?: string
						scope?: string
						value?: string
						name?: string
						imageUrl?: string
					}>
				}
			).baskets ?? []
		const isView =
			baskets.length > 0 &&
			baskets.every((b) => b.scope || b.basket.startsWith('p '))
		const panels = baskets
			.filter((b) => b.imageUrl || b.name || b.value)
			.map((b) => ({
				title:
					b.scope === 'collection'
						? b.name
							? `Collection · ${b.name}`
							: 'Collection'
						: b.scope
							? b.scope
							: 'Basket',
				// Always surface the id once (shortened); full id on copy if needed
				subtitle: b.value
					? b.value.length > 24
						? `${b.value.slice(0, 10)}…${b.value.slice(-10)}`
						: b.value
					: b.basket,
				subtitleCopy: b.value,
				...(b.imageUrl && {
					previewKind: 'image' as const,
					contentUrl: b.imageUrl,
					imageUrl: b.imageUrl,
				}),
				tone: 'default' as const,
			}))
		const rows = baskets.flatMap((b) => {
			if (b.scope === 'collection') {
				// Id lives on the panel; only add access line if present
				return b.description
					? [{ key: 'Access', value: b.description }]
					: []
			}
			return [
				{
					key: b.basket,
					value: b.description ?? 'List, insert, and remove outputs',
				},
			]
		})
		return {
			title: isView
				? baskets.length === 1
					? baskets[0].scope === 'collection'
						? 'Grant Collection View'
						: 'Grant Item View'
					: `Grant View (${baskets.length})`
				: baskets.length === 1
					? 'Grant Basket Access'
					: `Grant Access to ${baskets.length} Baskets`,
			subtitle: isView
				? `${shortenOriginator(req.originator)} wants to view items in your wallet`
				: `${shortenOriginator(req.originator)} wants to read and write 1Sat baskets`,
			panels,
			rows,
		}
	}

	if (req.kind === 'protocol') {
		return {
			title: 'Protocol Access',
			subtitle: `${shortenOriginator(req.originator)} wants protocol access`,
			panels: [],
			rows: [{ key: 'Detail', value: req.summary || 'Protocol request' }],
		}
	}

	return {
		title: 'Signature Request',
		subtitle: `${shortenOriginator(req.originator)} wants a signature`,
		panels: [],
		rows: [{ key: 'Detail', value: req.summary || 'Signature request' }],
	}
}

function applyVerification(
	base: ViewModel,
	res: VerificationResult,
): ViewModel {
	const panels = base.panels.map((p, i) => {
		if (i !== 0) return p
		const keepOpns = p.previewKind === 'opns'
		const kindFromVerify = res.contentType
			? previewKindFromContentType(res.contentType)
			: undefined
		const nextKind = keepOpns
			? 'opns'
			: kindFromVerify && kindFromVerify !== 'none'
				? kindFromVerify
				: p.previewKind
		const mediaUrl = res.contentUrl ?? p.contentUrl ?? p.imageUrl
		// Overlay may return a case-preserving token symbol as `name`.
		let subtitle = p.subtitle
		if (res.name && !keepOpns) {
			if (!subtitle) {
				subtitle = res.name
			} else {
				// Replace trailing ticker (e.g. "0.01 scam" → "0.01 SCAM").
				const parts = subtitle.trim().split(/\s+/)
				if (parts.length >= 2) {
					parts[parts.length - 1] = res.name
					subtitle = parts.join(' ')
				}
			}
		}
		return {
			...p,
			previewKind: nextKind,
			...(subtitle ? { subtitle } : {}),
			...(keepOpns
				? {
						...(res.contentUrl && !p.imageUrl
							? { imageUrl: res.contentUrl }
							: p.imageUrl
								? { imageUrl: p.imageUrl }
								: {}),
					}
				: nextKind === 'image'
					? { imageUrl: mediaUrl, contentUrl: mediaUrl }
					: mediaUrl
						? { contentUrl: mediaUrl, imageUrl: undefined }
						: {}),
		}
	})

	return {
		...base,
		panels,
		trust: { state: res.state, note: res.note },
	}
}

function previewKindFromContentType(
	ct: string,
): NonNullable<PromptPanel['previewKind']> {
	const c = ct.toLowerCase()
	if (c === 'image/svg+xml' || c === 'svg' || c.endsWith('+svg')) return 'svg'
	if (c.startsWith('image/')) return 'image'
	if (c.includes('json')) return 'json'
	if (c.includes('html') || c === 'application/xhtml+xml') return 'html'
	if (c.startsWith('text/')) return 'text'
	return 'none'
}

// ---------------------------------------------------------------------------
// Media preview widgets (chrome only)
// ---------------------------------------------------------------------------

function formatSatsFull(n: number): string {
	return `${n.toLocaleString('en-US')} sats`
}

function formatSats(n: number): string {
	return n.toLocaleString('en-US')
}

function trustLabel(state: string): string {
	if (state === 'verified') return 'Verified'
	if (state === 'mismatch') return 'Mismatch'
	return 'Unverified'
}

function PanelPreview({ panel }: { panel: PromptPanel }) {
	const variant = panel.variant ?? 'ordinal'
	const baseClass =
		variant === 'token'
			? 'opp-featured-image opp-featured-image-token'
			: variant === 'value'
				? 'opp-featured-image opp-preview-value'
				: 'opp-featured-image'
	const kind = panel.previewKind ?? (panel.imageUrl ? 'image' : 'none')
	const mediaUrl = panel.contentUrl ?? panel.imageUrl
	const [imgBroken, setImgBroken] = useState(false)

	if (variant === 'value') {
		const icon = panel.valueIcon ?? 'pay'
		return (
			<div
				className={baseClass}
				title={
					panel.amountSats != null
						? formatSatsFull(panel.amountSats)
						: undefined
				}
				aria-hidden
			>
				<ValueGlyph kind={icon} />
			</div>
		)
	}

	if (kind === 'opns') {
		const showAvatar = Boolean(panel.imageUrl) && !imgBroken
		return (
			<div
				className={`${baseClass} opp-preview-opns`}
				aria-hidden={!panel.opnsHero}
			>
				{showAvatar ? (
					<img
						className="opp-preview-opns-avatar"
						src={panel.imageUrl}
						alt=""
						onError={() => setImgBroken(true)}
					/>
				) : (
					<div className="opp-preview-opns-avatar opp-featured-placeholder">
						◈
					</div>
				)}
				<span className="opp-preview-opns-name" title={panel.opnsHero}>
					{panel.opnsHero ?? 'OpNS'}
				</span>
			</div>
		)
	}

	if (kind === 'image' && panel.imageUrl && !imgBroken) {
		return (
			<img
				className={baseClass}
				src={panel.imageUrl}
				alt={panel.title}
				onError={() => setImgBroken(true)}
			/>
		)
	}

	if (kind === 'image' && imgBroken) {
		return (
			<div className={`${baseClass} opp-featured-placeholder`} aria-hidden>
				▭
			</div>
		)
	}

	if (
		(kind === 'text' || kind === 'json' || kind === 'html') &&
		panel.previewText
	) {
		return (
			<pre
				className={`${baseClass} opp-preview-text${kind === 'json' ? ' opp-preview-json' : ''}`}
			>
				{panel.previewText}
			</pre>
		)
	}

	if ((kind === 'text' || kind === 'json') && mediaUrl) {
		return (
			<FetchedTextPreview url={mediaUrl} kind={kind} className={baseClass} />
		)
	}

	if ((kind === 'html' || kind === 'svg') && mediaUrl) {
		return (
			<iframe
				className={`${baseClass} opp-preview-frame`}
				src={mediaUrl}
				title={`${panel.title} preview`}
				sandbox=""
				referrerPolicy="no-referrer"
			/>
		)
	}

	return (
		<div className={`${baseClass} opp-featured-placeholder`} aria-hidden>
			{variant === 'token' ? '◎' : previewGlyph(kind)}
		</div>
	)
}

function previewGlyph(kind: string): string {
	if (kind === 'text' || kind === 'json') return '¶'
	if (kind === 'html' || kind === 'svg') return '⌂'
	return '▭'
}

function ValueGlyph({ kind }: { kind: 'lock' | 'unlock' | 'pay' }) {
	if (kind === 'lock') {
		return (
			<svg
				className="opp-preview-value-icon"
				viewBox="0 0 24 24"
				fill="none"
				aria-hidden
			>
				<rect
					x="5"
					y="11"
					width="14"
					height="10"
					rx="2"
					stroke="currentColor"
					strokeWidth="2"
				/>
				<path
					d="M8 11V8a4 4 0 018 0v3"
					stroke="currentColor"
					strokeWidth="2"
					strokeLinecap="round"
				/>
			</svg>
		)
	}
	if (kind === 'unlock') {
		return (
			<svg
				className="opp-preview-value-icon"
				viewBox="0 0 24 24"
				fill="none"
				aria-hidden
			>
				<rect
					x="5"
					y="11"
					width="14"
					height="10"
					rx="2"
					stroke="currentColor"
					strokeWidth="2"
				/>
				<path
					d="M8 11V7.5A4 4 0 0116 7"
					stroke="currentColor"
					strokeWidth="2"
					strokeLinecap="round"
				/>
				<path
					d="M16 4.5v3"
					stroke="currentColor"
					strokeWidth="2"
					strokeLinecap="round"
				/>
			</svg>
		)
	}
	return (
		<svg
			className="opp-preview-value-icon"
			viewBox="0 0 24 24"
			fill="none"
			aria-hidden
		>
			<circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
			<path
				d="M12 7v10M9 10.5c0-1.4 1.3-2.5 3-2.5s3 1.1 3 2.5-1.3 2.5-3 2.5-3 1.1-3 2.5 1.3 2.5 3 2.5 3-1.1 3-2.5"
				stroke="currentColor"
				strokeWidth="2"
				strokeLinecap="round"
			/>
		</svg>
	)
}

function FetchedTextPreview({
	url,
	kind,
	className,
}: {
	url: string
	kind: 'text' | 'json'
	className: string
}) {
	const [body, setBody] = useState<string | null>(null)
	const [failed, setFailed] = useState(false)

	useEffect(() => {
		let cancelled = false
		setBody(null)
		setFailed(false)
		void fetch(url)
			.then(async (res) => {
				if (!res.ok) throw new Error(String(res.status))
				const text = await res.text()
				if (cancelled) return
				if (kind === 'json') {
					try {
						setBody(JSON.stringify(JSON.parse(text), null, 2))
						return
					} catch {
						// raw
					}
				}
				setBody(text.slice(0, 800))
			})
			.catch(() => {
				if (!cancelled) setFailed(true)
			})
		return () => {
			cancelled = true
		}
	}, [url, kind])

	if (failed) {
		return (
			<div className={`${className} opp-featured-placeholder`} aria-hidden>
				¶
			</div>
		)
	}

	return (
		<pre
			className={`${className} opp-preview-text${kind === 'json' ? ' opp-preview-json' : ''}`}
		>
			{body ?? '…'}
		</pre>
	)
}

function CopyButton({ text }: { text: string }) {
	const [copied, setCopied] = useState(false)
	const onCopy = () => {
		void navigator.clipboard?.writeText(text).then(() => {
			setCopied(true)
			window.setTimeout(() => setCopied(false), 1200)
		})
	}
	return (
		<button
			type="button"
			className="opp-copy"
			onClick={onCopy}
			aria-label={copied ? 'Copied' : 'Copy full value'}
			title={copied ? 'Copied' : 'Copy'}
		>
			{copied ? (
				<svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden>
					<path
						d="M5 13l4 4L19 7"
						stroke="currentColor"
						strokeWidth="2.5"
						strokeLinecap="round"
						strokeLinejoin="round"
					/>
				</svg>
			) : (
				<svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden>
					<rect
						x="9"
						y="9"
						width="11"
						height="11"
						rx="2"
						stroke="currentColor"
						strokeWidth="2"
					/>
					<path
						d="M5 15V5a2 2 0 012-2h10"
						stroke="currentColor"
						strokeWidth="2"
						strokeLinecap="round"
					/>
				</svg>
			)}
		</button>
	)
}

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

function shortenOriginator(origin: string): string {
	try {
		const u = new URL(origin.includes('://') ? origin : `https://${origin}`)
		return u.host || origin
	} catch {
		if (origin.length <= 32) return origin
		return `${origin.slice(0, 14)}…${origin.slice(-12)}`
	}
}
