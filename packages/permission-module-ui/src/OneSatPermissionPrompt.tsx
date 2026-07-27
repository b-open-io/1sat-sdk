'use client'

import type { PromptRequest } from '@1sat/permission-module'
import {
	BSV21_BASKET,
	LOCK_BASKET,
	OPNS_BASKET,
	ORDINALS_BASKET,
} from '@1sat/types'
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
}

interface DetailRow {
	key: string
	/** Display value (may be truncated). */
	value: string
	/** Full string for clipboard when truncated / researchable. */
	copyValue?: string
}

type TrustState = 'verified' | 'unverified' | 'mismatch'

interface IntentSummary {
	title: string
	subtitle: string
	rows: DetailRow[]
	/** @deprecated Network fee is out of scope on 1sat cards. */
	feeSats?: number
	network?: string
	/** NFT / ordinal / token preview. */
	featured?: {
		imageUrl?: string
		title: string
		subtitle?: string
		/** Full subtitle for copy (e.g. token id). */
		subtitleCopy?: string
		/** Circular token icon vs square ordinal thumb. */
		variant?: 'ordinal' | 'token'
	}
	trust?: {
		state: TrustState
		note?: string
	}
	/** Overlay/indexer processing fee (not miner fee). */
	indexerFee?: {
		sats: number
		note?: string
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
	/** Sale price decoded from the OrdLock script — authoritative over `price:`. */
	listingPriceSats?: number
	/** Seller payout address decoded from the OrdLock script. */
	listingSeller?: string
	/** Block height decoded from the Lock script — authoritative over `until:`. */
	lockUntilHeight?: number
}

/**
 * Drop-in component for rendering 1Sat permission prompts.
 *
 * The host wallet feeds in the `request` it received from its promptHandler
 * callback and wires `onApprove`/`onReject` to resolve the same Promise.
 * Layout mirrors `docs/plans/mockups/p1sat-permissions.pen` — 1Sat coin
 * badge, intent title, asset detail card, network/fee, approve/reject.
 */
export function OneSatPermissionPrompt({
	request,
	onApprove,
	onReject,
	theme = 'auto',
}: OneSatPermissionPromptProps) {
	const resolvedTheme = useResolvedTheme(theme)
	const base = summarizeRequest(request)
	const [busy, setBusy] = useState(false)
	const [verified, setVerified] = useState<
		NonNullable<Awaited<TransactionIntent['verification']>> | undefined
	>(undefined)

	// Upgrade the trust badge if a service answers. Ignored when the module
	// supplied no `verification` promise, or the prompt closes first.
	const verification = (
		request.intent as { verification?: TransactionIntent['verification'] }
	)?.verification
	useEffect(() => {
		if (!verification) return
		let live = true
		verification
			.then((res) => {
				if (live && res) setVerified(res)
			})
			.catch(() => undefined)
		return () => {
			live = false
		}
	}, [verification])

	const summary = verified
		? applyVerification(base, verified)
		: base

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
			// Same guard the buttons use — the two paths should not differ.
			if (busy) return
			if (e.key === 'Escape') onReject()
			else if (e.key === 'Enter') onApprove()
		}
		window.addEventListener('keydown', onKey)
		return () => window.removeEventListener('keydown', onKey)
	}, [onApprove, onReject, busy])

	const className = `opp-root${resolvedTheme === 'dark' ? ' opp-dark' : ''}`
	const featuredVariant = summary.featured?.variant ?? 'ordinal'

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
				<h2 className="opp-title">{summary.title}</h2>
				<p className="opp-subtitle">{summary.subtitle}</p>
				<div className="opp-status">Awaiting Approval</div>
			</div>

			{summary.featured && (
				<div
					className={`opp-featured${featuredVariant === 'token' ? ' opp-featured-token' : ''}`}
				>
					{summary.featured.imageUrl ? (
						<img
							className={
								featuredVariant === 'token'
									? 'opp-featured-image opp-featured-image-token'
									: 'opp-featured-image'
							}
							src={summary.featured.imageUrl}
							alt={summary.featured.title}
						/>
					) : (
						<div
							className={
								featuredVariant === 'token'
									? 'opp-featured-image opp-featured-image-token opp-featured-placeholder'
									: 'opp-featured-image opp-featured-placeholder'
							}
							aria-hidden
						>
							{featuredVariant === 'token' ? '◎' : '▭'}
						</div>
					)}
					<div className="opp-featured-meta">
						<div className="opp-featured-title">{summary.featured.title}</div>
						{summary.featured.subtitle && (
							<div className="opp-featured-subtitle">
								<span className="opp-featured-subtitle-text">
									{summary.featured.subtitle}
								</span>
								{summary.featured.subtitleCopy && (
									<CopyButton text={summary.featured.subtitleCopy} />
								)}
							</div>
						)}
					</div>
				</div>
			)}

			{summary.trust && (
				<div className="opp-trust-wrap">
					<span className={`opp-trust opp-trust-${summary.trust.state}`}>
						{trustLabel(summary.trust.state)}
					</span>
					{summary.trust.note && (
						<div className={`opp-trust-note opp-trust-note-${summary.trust.state}`}>
							{summary.trust.note}
						</div>
					)}
				</div>
			)}

			{(summary.rows.length > 0 || summary.indexerFee) && (
				<div className="opp-card">
					{summary.rows.map((row) => (
						<div className="opp-row" key={`${row.key}:${row.value}`}>
							<span className="opp-row-key">{row.key}</span>
							<span className="opp-row-value-wrap">
								<span className="opp-row-value" title={row.copyValue ?? row.value}>
									{row.value}
								</span>
								{row.copyValue && <CopyButton text={row.copyValue} />}
							</span>
						</div>
					))}
					{summary.indexerFee && (
						<>
							<div className="opp-row">
								<span className="opp-row-key">Indexer fee</span>
								<span className="opp-row-value">
									{formatSats(summary.indexerFee.sats)} sats
								</span>
							</div>
							{summary.indexerFee.note && (
								<div className="opp-fee-note">{summary.indexerFee.note}</div>
							)}
						</>
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

function trustLabel(state: TrustState): string {
	if (state === 'verified') return 'Verified'
	if (state === 'mismatch') return 'Mismatch'
	return 'Unverified'
}

function formatSats(n: number): string {
	return n.toLocaleString('en-US')
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

/** Middle-truncate for display; keep full value for copy. */
function copyable(key: string, full: string): DetailRow {
	return { key, value: shortenValue(full), copyValue: full }
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

/**
 * Fold a resolved verification into the card.
 *
 * Service-confirmed values replace whatever the request asserted — the origin
 * especially, since a purchase carries the seller's listing outpoint rather
 * than the asset's genesis, which is also why the preview is blank until this
 * lands.
 */
function applyVerification(
	base: IntentSummary,
	res: NonNullable<Awaited<TransactionIntent['verification']>>,
): IntentSummary {
	const rows = base.rows.map((row) => {
		if (row.key === 'Origin' && res.origin) return copyable('Origin', res.origin)
		if (row.key === 'Type' && res.contentType) {
			return { key: 'Type', value: res.contentType }
		}
		return row
	})

	if (res.contentLength !== undefined && !rows.some((r) => r.key === 'Size')) {
		rows.push({
			key: 'Size',
			value: `${res.contentLength.toLocaleString('en-US')} bytes`,
		})
	}

	return {
		...base,
		rows,
		trust: { state: res.state, note: res.note },
		featured: base.featured
			? {
					...base.featured,
					title: res.name ?? base.featured.title,
					imageUrl: res.contentUrl ?? base.featured.imageUrl,
				}
			: undefined,
	}
}

function summarizeRequest(req: PromptRequest): IntentSummary {
	if (req.kind === 'transaction') {
		const intent = req.intent as unknown as TransactionIntent
		const byIntent = summarizeByP1SatIntent(req, intent)
		if (byIntent) return byIntent
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
			case 'listing':
				return summarizeListing(req, intent)
			case 'cancel-listing':
				return summarizeCancelListing(req, intent)
			case 'purchase':
				return summarizePurchase(req, intent)
			case 'social-post':
				return summarizeSocialPost(req, intent)
			case 'opns':
				return summarizeOpns(req, intent)
			default:
				return summarizeUnknownTx(req, intent)
		}
	}
	if (req.kind === 'protocol') {
		return summarizeProtocol(req)
	}
	if (req.kind === 'basketAccess') {
		return summarizeBasketAccess(req)
	}
	return summarizeSignature(req)
}

interface BasketAccessIntent {
	baskets: Array<{ basket: string; description?: string }>
}

function summarizeBasketAccess(req: PromptRequest): IntentSummary {
	const intent = req.intent as unknown as BasketAccessIntent
	const baskets = intent.baskets ?? []
	return {
		title:
			baskets.length === 1
				? 'Grant Basket Access'
				: `Grant Access to ${baskets.length} Baskets`,
		subtitle: `${shortenOriginator(req.originator)} wants to read and write 1Sat baskets`,
		rows: baskets.map((b) => ({
			key: b.basket,
			value: b.description ?? 'List, insert, and remove outputs',
		})),
	}
}

interface TransactionIntent {
	kind:
		| 'ordinal-transfer'
		| 'token-transfer'
		| 'lock'
		| 'unlock'
		| 'inscription'
		| 'listing'
		| 'cancel-listing'
		| 'purchase'
		| 'social-post'
		| 'opns'
		| 'unknown'
	/** Explicit `p 1sat intent <domain>.<verb>` when present. */
	p1satIntent?: string
	inputs: AssetEntry[]
	outputs: OutputEntry[]
	contentUrls?: Record<string, string>
	chain?: string
	/** Optional module-supplied trust (purchases / hint paths). */
	trust?: { state: TrustState; note?: string }
	/**
	 * Resolves when a service answers, upgrading `trust` in place.
	 *
	 * The card renders immediately as `unverified` and never waits on this —
	 * an unreachable overlay delays the badge, not the prompt. Hosts that
	 * ignore the field simply keep the initial state.
	 */
	verification?: Promise<{
		state: TrustState
		note?: string
		contentType?: string
		contentLength?: number
		origin?: string
		name?: string
		contentUrl?: string
	}>

	/** Optional module-supplied overlay processing fee. */
	indexerFeeSats?: number
	indexerFeeNote?: string
}

/** Mockup-brief titles keyed by intent id. */
const INTENT_TITLES: Record<string, string> = {
	'opns.register': 'Publish name',
	'opns.deregister': 'Unpublish name',
	'opns.list': 'List name for sale',
	'opns.transfer': 'Transfer name',
	'opns.cancel-listing': 'Cancel listing',
	'opns.purchase': 'Buy name',
	'ordinal.transfer': 'Send ordinal',
	'ordinal.list': 'List for sale',
	'ordinal.cancel-listing': 'Cancel listing',
	'ordinal.purchase': 'Buy ordinal',
	'ordinal.burn': 'Burn ordinal',
	'ordinal.inscribe': 'Create inscription',
	'ordinal.inscribe-sigma': 'Create inscription',
	'ordinal.mint-collection': 'Mint collection',
	'ordinal.mint-item': 'Mint collection item',
	'lock.lock': 'Lock BSV',
	'lock.unlock': 'Unlock BSV',
	'bsv21.transfer': 'Send tokens',
	'bsv21.purchase': 'Buy tokens',
	'bsv21.mint': 'Mint tokens',
	'bsv21.deploy': 'Deploy token',
}

/**
 * When module supplies `p1satIntent`, build the card from that id and
 * reuse family summarizers for rows/featured (titles/subtitles overridden).
 */
function summarizeByP1SatIntent(
	req: PromptRequest,
	intent: TransactionIntent,
): IntentSummary | undefined {
	const id = intent.p1satIntent
	if (!id || !INTENT_TITLES[id]) return undefined

	let base: IntentSummary
	switch (intent.kind) {
		case 'ordinal-transfer':
			base = summarizeOrdinalTransfer(req, intent)
			break
		case 'token-transfer':
			base = summarizeTokenTransfer(req, intent)
			break
		case 'lock':
			base = summarizeLock(req, intent)
			break
		case 'unlock':
			base = summarizeUnlock(req, intent)
			break
		case 'inscription':
			base = summarizeInscription(req, intent)
			break
		case 'listing':
			base = summarizeListing(req, intent)
			break
		case 'cancel-listing':
			base = summarizeCancelListing(req, intent)
			break
		case 'purchase':
			base = summarizePurchase(req, intent)
			break
		case 'opns':
			base = summarizeOpns(req, intent)
			break
		default:
			base = summarizeUnknownTx(req, intent)
	}

	return {
		...base,
		title: INTENT_TITLES[id],
		subtitle: intentSubtitle(req, id, intent),
		// 1sat card does not own network fee / DSAP spend.
		feeSats: undefined,
		network: undefined,
		trust: intent.trust ?? base.trust,
		indexerFee:
			intent.indexerFeeSats != null && intent.indexerFeeSats > 0
				? {
						sats: intent.indexerFeeSats,
						note: intent.indexerFeeNote,
					}
				: base.indexerFee,
	}
}

function intentSubtitle(
	req: PromptRequest,
	id: string,
	intent: TransactionIntent,
): string {
	const o = shortenOriginator(req.originator)
	const name =
		tagValue(intent.inputs[0]?.tags, 'name') ??
		tagValue(
			intent.outputs.find((out) => out.tags.some((t) => t.startsWith('name:')))
				?.tags,
			'name',
		)
	const quoted = name ? `“${name}”` : undefined
	switch (id) {
		case 'opns.register':
			return `${o} wants to publish ${quoted ?? 'an OpNS name'}`
		case 'opns.deregister':
			return `${o} wants to unpublish ${quoted ?? 'an OpNS name'}`
		case 'opns.list':
			return `${o} wants to list ${quoted ?? 'an OpNS name'} for sale`
		case 'opns.transfer':
			return `${o} wants to transfer ${quoted ?? 'an OpNS name'}`
		case 'opns.cancel-listing':
			return `${o} wants to cancel ${quoted ? `the listing of ${quoted}` : 'an OpNS listing'}`
		case 'opns.purchase':
			return `${o} wants to buy ${quoted ?? 'an OpNS name'}`
		case 'ordinal.transfer':
			return `${o} wants to transfer an ordinal`
		case 'ordinal.list':
			return `${o} wants to list ${quoted ?? 'an ordinal'} for sale`
		case 'ordinal.cancel-listing':
			return `${o} wants to cancel ${quoted ? `the listing of ${quoted}` : 'an ordinal listing'}`
		case 'ordinal.purchase':
			return `${o} wants to purchase an ordinal into your wallet`
		case 'ordinal.burn':
			return `${o} wants to burn an ordinal`
		case 'ordinal.inscribe':
		case 'ordinal.inscribe-sigma':
			return `${o} wants to inscribe content into your wallet`
		case 'ordinal.mint-collection':
			return `${o} wants to mint a collection`
		case 'ordinal.mint-item':
			return `${o} wants to mint a collection item`
		case 'lock.lock':
			return `${o} wants to time-lock funds`
		case 'lock.unlock':
			return `${o} wants to unlock matured locks`
		case 'bsv21.transfer':
			return `${o} wants to send tokens`
		case 'bsv21.purchase':
			return `${o} wants to purchase tokens into your wallet`
		case 'bsv21.mint':
			return `${o} wants to mint tokens`
		case 'bsv21.deploy':
			return `${o} wants to deploy a BSV21 token`
		default:
			return `${o} wants to ${req.summary.toLowerCase()}`
	}
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
	const imageUrl = origin ? intent.contentUrls?.[origin] : undefined

	const rows: DetailRow[] = []
	if (recipient) rows.push(copyable('Recipient', recipient))
	if (origin) rows.push(copyable('Origin', origin))
	if (contentType) rows.push({ key: 'Type', value: contentType })

	return {
		title: 'Send ordinal',
		subtitle: `${shortenOriginator(req.originator)} wants to transfer an ordinal`,
		rows,
		featured: imageUrl
			? {
					imageUrl,
					title: name ?? 'Untitled ordinal',
					subtitle: collectionId ?? contentType,
				}
			: undefined,
	}
}

function summarizeTokenTransfer(
	req: PromptRequest,
	intent: TransactionIntent,
): IntentSummary {
	// Per-token totals: inputs spent, change returned to sender.
	// Net amount sent = inputs - change.
	const totals = new Map<
		string,
		{ sym?: string; inAmt: bigint; changeAmt: bigint }
	>()
	for (const input of intent.inputs) {
		const tokenId = tagValue(input.tags, 'bsv21')
		if (!tokenId) continue
		const sym = tagValue(input.tags, 'sym')
		const amt = BigInt(tagValue(input.tags, 'amt') ?? '0')
		const cur = totals.get(tokenId) ?? { sym, inAmt: 0n, changeAmt: 0n }
		cur.inAmt += amt
		if (!cur.sym && sym) cur.sym = sym
		totals.set(tokenId, cur)
	}
	for (const output of intent.outputs) {
		if (output.basket !== BSV21_BASKET) continue
		const tokenId = tagValue(output.tags, 'bsv21')
		if (!tokenId) continue
		const amt = BigInt(tagValue(output.tags, 'amt') ?? '0')
		const cur = totals.get(tokenId)
		if (cur) cur.changeAmt += amt
	}

	const rows: DetailRow[] = []
	let featured: IntentSummary['featured']
	let primaryTokenId: string | undefined
	for (const [tokenId, info] of totals) {
		if (!primaryTokenId) primaryTokenId = tokenId
		const sent = info.inAmt - info.changeAmt
		rows.push({ key: 'Amount', value: sent.toLocaleString('en-US') })
	}
	// Token carrier outs are 1 sat; overlay fee outs are larger.
	const to = intent.outputs.find(
		(o) => o.recipient && o.satoshis === 1,
	)?.recipient
	if (to) rows.push(copyable('Recipient', to))

	const firstIn = intent.inputs.find((i) => tagValue(i.tags, 'bsv21'))
	const sym =
		(primaryTokenId ? totals.get(primaryTokenId)?.sym : undefined) ??
		tagValue(firstIn?.tags, 'sym')
	const iconRef = tagValue(firstIn?.tags, 'icon')
	const iconUrl =
		(iconRef && intent.contentUrls?.[iconRef]) ||
		(primaryTokenId && intent.contentUrls?.[primaryTokenId]) ||
		undefined
	if (primaryTokenId) {
		featured = {
			variant: 'token',
			imageUrl: iconUrl,
			title: sym ?? 'Token',
			subtitle: shortenId(primaryTokenId),
			subtitleCopy: primaryTokenId,
		}
	}

	const indexerFee = resolveIndexerFee(intent)

	return {
		title: 'Send tokens',
		subtitle: `${shortenOriginator(req.originator)} wants to send tokens`,
		rows,
		featured,
		indexerFee,
	}
}

/**
 * Indexer/overlay fee: module may supply sats; else heuristic —
 * unbasketed outs that are not 1-sat token carriers and look like fee totals.
 */
function resolveIndexerFee(
	intent: TransactionIntent,
): IntentSummary['indexerFee'] {
	if (intent.indexerFeeSats != null && intent.indexerFeeSats > 0) {
		return {
			sats: intent.indexerFeeSats,
			note: intent.indexerFeeNote,
		}
	}
	const tokenOutCount = intent.outputs.filter(
		(o) => o.basket === BSV21_BASKET || tagValue(o.tags, 'bsv21'),
	).length
	// Fee outs: no basket, has recipient, sats > 1 (not 1-sat inscription dust).
	const feeLike = intent.outputs.filter(
		(o) => !o.basket && o.recipient && o.satoshis > 1,
	)
	// On pure transfers there is no seller payment — a single fee-like out is the indexer fee.
	// On purchases, the largest fee-like out is usually the seller; skip heuristic there.
	const isPurchase =
		intent.p1satIntent?.endsWith('.purchase') || intent.kind === 'purchase'
	if (isPurchase || feeLike.length !== 1) return undefined
	const fee = feeLike[0]
	if (!fee || fee.satoshis <= 0) return undefined
	const note =
		tokenOutCount > 0
			? `Overlay processing · ${formatSats(Math.round(fee.satoshis / tokenOutCount))} sats × ${tokenOutCount} token outs`
			: 'Overlay processing fee'
	return { sats: fee.satoshis, note }
}

function summarizeLock(
	req: PromptRequest,
	intent: TransactionIntent,
): IntentSummary {
	// Prefer outputs whose locking script actually decodes as a Lock — the
	// basket is caller-asserted, the script is not.
	const decoded = intent.outputs.filter((o) => o.lockUntilHeight !== undefined)
	const lockOutputs =
		decoded.length > 0
			? decoded
			: intent.outputs.filter((o) => o.basket === LOCK_BASKET)
	const sats = (lockOutputs.length > 0 ? lockOutputs : intent.outputs).reduce(
		(s, o) => s + o.satoshis,
		0,
	)
	// Script-decoded only; the `until:` tag is caller-asserted.
	const until = decoded[0]?.lockUntilHeight
	const rows: DetailRow[] = [
		{ key: 'Amount', value: `${sats.toLocaleString('en-US')} sats` },
	]
	if (until !== undefined) {
		rows.push({
			key: 'Lock until block',
			value: until.toLocaleString('en-US'),
		})
	}
	return {
		title: 'Lock BSV',
		subtitle: `${shortenOriginator(req.originator)} wants to time-lock funds`,
		rows,
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
	}
}

function summarizeInscription(
	req: PromptRequest,
	intent: TransactionIntent,
): IntentSummary {
	// The new inscription output is the first non-empty ordinals-bound output.
	const inscriptionOutput =
		intent.outputs.find((o) => o.tags.some((t) => t.startsWith('type:'))) ??
		intent.outputs[0]
	const contentType = tagValue(inscriptionOutput?.tags, 'type')
	const name = tagValue(inscriptionOutput?.tags, 'name')
	const recipient = inscriptionOutput?.recipient
	const rows: DetailRow[] = []
	if (contentType) rows.push({ key: 'Type', value: contentType })
	if (name) rows.push({ key: 'Name', value: name })
	if (recipient) rows.push(copyable('Recipient', recipient))
	return {
		title: 'Create Inscription',
		subtitle: `${shortenOriginator(req.originator)} wants to inscribe content into your wallet`,
		rows,
	}
}

function summarizeListing(
	req: PromptRequest,
	intent: TransactionIntent,
): IntentSummary {
	// Prefer the enriched input asset; the listing output carries the same
	// name/origin/type tags when no input label resolved.
	const listingOutput =
		intent.outputs.find((o) => o.listingPriceSats !== undefined) ??
		intent.outputs.find((o) => o.tags.some((t) => t.startsWith('price:')))
	const ordinal = intent.inputs[0]
	const origin =
		tagValue(ordinal?.tags, 'origin') ?? tagValue(listingOutput?.tags, 'origin')
	const name =
		tagValue(ordinal?.tags, 'name') ?? tagValue(listingOutput?.tags, 'name')
	const contentType =
		tagValue(ordinal?.tags, 'type') ?? tagValue(listingOutput?.tags, 'type')
	const collectionId = tagValue(ordinal?.tags, 'collectionId')
	const imageUrl = origin ? intent.contentUrls?.[origin] : undefined

	// Script-decoded only. The `price:` tag is caller-asserted and must not
	// reach the card — it is what the dApp claims, not what the chain enforces.
	const price = listingOutput?.listingPriceSats

	const rows: DetailRow[] = []
	if (name) rows.push({ key: 'Name', value: name })
	if (price !== undefined) {
		rows.push({ key: 'Price', value: `${price.toLocaleString('en-US')} sats` })
	}
	if (origin) rows.push(copyable('Origin', origin))
	if (contentType) rows.push({ key: 'Type', value: contentType })

	return {
		title: 'List Ordinal for Sale',
		subtitle: `${shortenOriginator(req.originator)} wants to list ${name ? `“${name}”` : 'an ordinal'} for sale`,
		rows,
		featured: imageUrl
			? {
					imageUrl,
					title: name ?? 'Untitled ordinal',
					subtitle: collectionId ?? contentType,
				}
			: undefined,
	}
}

function summarizeCancelListing(
	req: PromptRequest,
	intent: TransactionIntent,
): IntentSummary {
	// Prefer the enriched listing input; the reclaimed output carries the
	// same name/origin/type tags when no input label resolved.
	const listing = intent.inputs[0]
	const reclaimed = intent.outputs[0]
	const origin =
		tagValue(listing?.tags, 'origin') ?? tagValue(reclaimed?.tags, 'origin')
	const name =
		tagValue(listing?.tags, 'name') ?? tagValue(reclaimed?.tags, 'name')
	const contentType =
		tagValue(listing?.tags, 'type') ?? tagValue(reclaimed?.tags, 'type')
	const collectionId = tagValue(listing?.tags, 'collectionId')
	const price = tagValue(listing?.tags, 'price')
	const imageUrl = origin ? intent.contentUrls?.[origin] : undefined

	const rows: DetailRow[] = []
	if (name) rows.push({ key: 'Name', value: name })
	if (price) rows.push({ key: 'Original price', value: `${price} sats` })
	if (origin) rows.push(copyable('Origin', origin))
	if (contentType) rows.push({ key: 'Type', value: contentType })

	return {
		title: 'Cancel Listing',
		subtitle: `${shortenOriginator(req.originator)} wants to cancel ${name ? `the listing of “${name}”` : 'an ordinal listing'}`,
		rows,
		featured: imageUrl
			? {
					imageUrl,
					title: name ?? 'Untitled ordinal',
					subtitle: collectionId ?? contentType,
				}
			: undefined,
	}
}

function summarizePurchase(
	req: PromptRequest,
	intent: TransactionIntent,
): IntentSummary {
	// The asset coming into the wallet is the first basket-bound output.
	const incoming = intent.outputs.find(
		(o) => o.basket === ORDINALS_BASKET || o.basket === BSV21_BASKET,
	)
	const isToken = incoming?.basket === BSV21_BASKET
	const origin = tagValue(incoming?.tags, 'origin')
	const name = tagValue(incoming?.tags, 'name')
	const contentType = tagValue(incoming?.tags, 'type')
	const collectionId = tagValue(incoming?.tags, 'collectionId')
	const sym = tagValue(incoming?.tags, 'sym')
	const amt = tagValue(incoming?.tags, 'amt')
	const tokenId = tagValue(incoming?.tags, 'bsv21')

	// Seller payment is the unbasketed P2PKH output with sats > 1.
	const sellerOutput = intent.outputs.find(
		(o) => !o.basket && o.recipient && o.satoshis > 1,
	)
	const price = sellerOutput?.satoshis

	const rows: DetailRow[] = []
	if (price !== undefined) rows.push({ key: 'Price', value: `${price.toLocaleString('en-US')} sats` })
	if (isToken) {
		if (amt) rows.push({ key: 'Amount', value: amt })
	} else {
		if (origin) rows.push(copyable('Origin', origin))
		if (contentType) rows.push({ key: 'Type', value: contentType })
	}

	const featuredImage =
		!isToken && origin ? intent.contentUrls?.[origin] : undefined
	const iconRef = tagValue(incoming?.tags, 'icon')
	const iconUrl =
		(iconRef && intent.contentUrls?.[iconRef]) ||
		(tokenId && intent.contentUrls?.[tokenId]) ||
		undefined

	let featured: IntentSummary['featured']
	if (isToken && (sym || tokenId)) {
		featured = {
			variant: 'token',
			imageUrl: iconUrl,
			title: sym ?? 'Token',
			subtitle: tokenId ? shortenId(tokenId) : undefined,
			subtitleCopy: tokenId,
		}
	} else if (featuredImage) {
		featured = {
			imageUrl: featuredImage,
			title: name ?? 'Untitled ordinal',
			subtitle: collectionId ?? contentType,
		}
	}

	return {
		title: isToken ? 'Buy tokens' : 'Buy ordinal',
		subtitle: isToken
			? `${shortenOriginator(req.originator)} wants to purchase tokens into your wallet`
			: `${shortenOriginator(req.originator)} wants to purchase an ordinal into your wallet`,
		rows,
		featured,
		trust: intent.trust,
		indexerFee: resolveIndexerFee(intent),
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
	}
}

function summarizeOpns(
	req: PromptRequest,
	intent: TransactionIntent,
): IntentSummary {
	// Register/deregister keep the name in the opns basket; a transfer sends
	// it to an external recipient with no basketed output.
	const input = intent.inputs[0]
	const opnsOutput = intent.outputs.find((o) => o.basket === OPNS_BASKET)
	const recipient = intent.outputs.find(
		(o) => !o.basket && o.recipient,
	)?.recipient
	const name =
		tagValue(input?.tags, 'name') ?? tagValue(opnsOutput?.tags, 'name')
	const origin =
		tagValue(input?.tags, 'origin') ?? tagValue(opnsOutput?.tags, 'origin')
	const priceTag = intent.outputs
		.flatMap((o) => o.tags)
		.find((t) => t.startsWith('price:'))
	const price = priceTag?.slice('price:'.length)

	const rows: DetailRow[] = []
	if (name) rows.push({ key: 'Name', value: name })
	if (recipient) rows.push(copyable('Recipient', recipient))
	if (price) rows.push({ key: 'Price', value: `${price} sats` })
	if (origin) rows.push(copyable('Origin', origin))

	const copy = opnsCopy(intent.p1satIntent, Boolean(recipient))
	const nameBit = name ? `“${name}”` : 'an OpNS name'
	return {
		title: copy.title,
		subtitle: `${shortenOriginator(req.originator)} wants to ${copy.verb} ${nameBit}`,
		rows,
	}
}

function opnsCopy(
	p1satIntent: string | undefined,
	isTransferHeuristic: boolean,
): { title: string; verb: string } {
	switch (p1satIntent) {
		case 'opns.register':
			return { title: 'Publish name', verb: 'publish' }
		case 'opns.deregister':
			return { title: 'Unpublish name', verb: 'unpublish' }
		case 'opns.list':
			return { title: 'List name for sale', verb: 'list' }
		case 'opns.transfer':
			return { title: 'Transfer name', verb: 'transfer' }
		case 'opns.cancel-listing':
			return { title: 'Cancel listing', verb: 'cancel the listing of' }
		case 'opns.purchase':
			return { title: 'Buy name', verb: 'buy' }
		default:
			return isTransferHeuristic
				? { title: 'Transfer OpNS Name', verb: 'transfer' }
				: { title: 'Update OpNS Name', verb: 'update' }
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
	}
}


function shortenId(id: string, max = 24): string {
	if (id.length <= max) return id
	return `${id.slice(0, 8)}…${id.slice(-6)}`
}

/**
 * Middle-truncate a long value (address, outpoint, hex id) so the user can
 * still recognise it without it wrapping over multiple lines. Returns the
 * original when it already fits.
 */
function shortenValue(value: string, head = 12, tail = 10): string {
	if (value.length <= head + tail + 1) return value
	return `${value.slice(0, head)}…${value.slice(-tail)}`
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
