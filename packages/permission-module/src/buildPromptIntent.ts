import { BSV21_BASKET, LOCK_BASKET, OPNS_BASKET } from '@1sat/types'
import { BSV21 } from '@1sat/templates'
import { Script } from '@bsv/sdk'
import type {
	EnrichedIntent,
	EnrichedOutput,
	OrdinalEdge,
	TxLeg,
} from './enrichIntent'
import type {
	PreviewKind,
	PromptDetailRow,
	PromptPanel,
	TransactionPrompt,
} from './promptModel'

/** Overlay-resolved token facts (dec/sym/icon) keyed by token id. */
export type TokenMetaMap = Record<
	string,
	{ dec?: number; sym?: string; icon?: string; iconUrl?: string }
>

/**
 * Turn enrich output into the serializable prompt IR the UI renders.
 * All classification and presentation facts are settled here.
 */
export function buildTransactionPrompt(
	enriched: EnrichedIntent,
	contentUrls: Record<string, string>,
	originator: string,
	tokenMeta: TokenMetaMap = {},
): TransactionPrompt {
	const panels: PromptPanel[] = []
	const rows: PromptDetailRow[] = []
	const consumed = new Set<string>()

	for (const edge of enriched.ordinalEdges) {
		panels.push(panelFromOrdinalEdge(edge, contentUrls))
	}

	// Token transfers: Send/Move/Burn panels + local conservation.
	const tokenResult = panelsFromTokenLegs(
		enriched.legs,
		enriched.outputs,
		contentUrls,
		consumed,
		tokenMeta,
	)
	for (const p of tokenResult.panels) {
		panels.push(p)
	}

	for (const leg of enriched.legs) {
		const key = legKey(leg)
		if (consumed.has(key)) continue
		if (leg.isIndexerFee) {
			consumed.add(key)
			continue
		}
		if (leg.inOrdinalEdge && !leg.sealPending) continue
		if (leg.inOrdinalEdge && leg.sealPending) {
			const onEdge = enriched.ordinalEdges.some(
				(e) => e.create?.index === leg.index && e.create?.sealPending,
			)
			if (onEdge) continue
			rows.push({
				key: 'Signature',
				value:
					leg.sealKind === 'sigma'
						? 'You will sign a Sigma commitment on this output'
						: leg.sealKind === 'pushdrop'
							? 'You will sign PushDrop data on this output'
							: 'You will sign data on this output',
			})
			continue
		}
		if (leg.inOrdinalEdge) continue

		const value = panelFromValueLeg(leg)
		if (value) {
			panels.push(value)
			continue
		}

		// Token change / residual token legs already covered by panels.
		if (isTokenLeg(leg)) continue

		rows.push({
			key: leg.side === 'input' ? 'Spend' : 'Output',
			value: leg.label,
			...(leg.outpoint ? { copyValue: leg.outpoint } : {}),
			...(leg.recipient ? { copyValue: leg.recipient } : {}),
		})
	}

	// Bad token math: Burn panel already carries the reason — no trust badge
	// (would duplicate) and no overlay verify (shape is already invalid).
	const trust = tokenResult.badMath ? undefined : enriched.trust

	const prompt: TransactionPrompt = {
		title: 'Transaction Request',
		subtitle: `${shortenOriginator(originator)} wants your approval`,
		panels,
		rows,
		...(trust && { trust }),
		...(enriched.indexerFeeSats != null && {
			indexerFee: {
				sats: enriched.indexerFeeSats,
				// Label is fixed in the UI as "1Sat Overlay Fee".
			},
		}),
		// funding: filled when admin pre-fund lands
	}

	if (trust) {
		prompt.verify = {
			kind: enriched.kind,
			inputs: enriched.inputs.map((i) => ({
				basket: i.basket,
				id: i.id,
				outpoint: i.outpoint,
				satoshis: i.satoshis,
				tags: i.tags,
				...(i.customInstructions
					? { customInstructions: i.customInstructions }
					: {}),
			})),
			outputs: enriched.outputs.map((o) => ({
				index: o.index,
				satoshis: o.satoshis,
				basket: o.basket,
				tags: o.tags,
				recipient: o.recipient,
				listingPriceSats: o.listingPriceSats,
			})),
			contentUrls,
		}
	}

	return prompt
}

function formatSatsFull(n: number): string {
	return `${n.toLocaleString('en-US')} sats`
}

function shortenMid(s: string, max: number): string {
	if (s.length <= max) return s
	const keep = Math.max(4, Math.floor((max - 1) / 2))
	return `${s.slice(0, keep)}…${s.slice(-keep)}`
}

function shortenOriginator(origin: string): string {
	try {
		const u = new URL(origin.includes('://') ? origin : `https://${origin}`)
		return u.host || origin
	} catch {
		return origin.length > 32 ? shortenMid(origin, 28) : origin
	}
}

function copyable(key: string, full: string): PromptDetailRow {
	return { key, value: shortenMid(full, 28), copyValue: full }
}

function contentTypeFromTags(tags: string[] | undefined): string | undefined {
	if (!tags?.length) return undefined
	const types = tags
		.filter((t) => t.startsWith('type:'))
		.map((t) => t.slice(5))
	if (!types.length) return undefined
	const specific = types.find((t) => t.includes('/'))
	return specific ?? types[types.length - 1]
}

function previewKindFromContentType(ct: string | undefined): PreviewKind {
	if (!ct) return 'none'
	const c = ct.toLowerCase()
	if (c === 'image/svg+xml' || c === 'svg' || c.endsWith('+svg')) return 'svg'
	if (c.startsWith('image/')) return 'image'
	if (c.includes('json')) return 'json'
	if (c.includes('html') || c === 'application/xhtml+xml') return 'html'
	if (c.startsWith('text/')) return 'text'
	return 'none'
}

function legKey(leg: TxLeg): string {
	return `${leg.side}:${leg.index}`
}

function isTokenLeg(leg: TxLeg): boolean {
	return (
		leg.template === 'bsv21' ||
		leg.basket === BSV21_BASKET ||
		!!leg.tokenId ||
		!!leg.tags?.some((t) => t.startsWith('bsv21:'))
	)
}

function tagFrom(tags: string[] | undefined, key: string): string | undefined {
	return tags?.find((t) => t.startsWith(`${key}:`))?.slice(key.length + 1)
}

/**
 * Format BSV21 base-unit amount with decimals.
 * amt is always the inscription integer string — never output satoshis.
 */
function formatTokenAmt(amt: string, dec?: number): string {
	const neg = amt.startsWith('-')
	const digits = (neg ? amt.slice(1) : amt).replace(/\D/g, '') || '0'
	// Reject absurd values that look like we accidentally fed satoshi dust.
	// (Callers must pass inscription amt only.)
	if (dec == null || dec <= 0) return neg ? `-${digits}` : digits
	const padded = digits.padStart(dec + 1, '0')
	const whole = padded.slice(0, -dec) || '0'
	const frac = padded.slice(-dec).replace(/0+$/, '')
	const body = frac ? `${whole}.${frac}` : whole
	return neg ? `-${body}` : body
}

/** Prefer live script decode over tags — external sends often have no tags. */
function tokenAmtFromOutput(out: EnrichedOutput | undefined, leg: TxLeg): string | undefined {
	if (leg.tokenAmt) return leg.tokenAmt
	const tagged = tagFrom(leg.tags, 'amt')
	if (tagged) return tagged
	if (out?.tokenAmt) return out.tokenAmt
	if (out?.lockingScript) {
		try {
			const d = BSV21.decode(Script.fromHex(out.lockingScript))
			if (d?.tokenData.amt) return String(d.tokenData.amt)
		} catch {
			// ignore
		}
	}
	return undefined
}

function parseAmt(a: string | undefined): bigint {
	if (!a) return 0n
	try {
		return BigInt(a.replace(/\D/g, '') || '0')
	} catch {
		return 0n
	}
}

function isMintOp(op: string | undefined): boolean {
	if (!op) return false
	const o = op.toLowerCase()
	return (
		o === 'mint' ||
		o === 'deploy+mint' ||
		o === 'deploy+auth' ||
		o === 'auth'
	)
}

/**
 * Build token Send / Burn panels.
 *
 * Conservation for approval UX:
 * - Send / Move for re-issued amts when math is OK
 * - Burn remainder when inputs > outputs (`inputs > outputs`)
 * - Bad math (outputs > inputs): **Burn only** (all inputs), no Send/Move;
 *   caller sets mismatch and skips overlay verify
 * Mint/deploy ops skip burn accounting.
 */
function panelsFromTokenLegs(
	legs: TxLeg[],
	outputs: EnrichedOutput[],
	contentUrls: Record<string, string>,
	consumed: Set<string>,
	tokenMeta: TokenMetaMap,
): { panels: PromptPanel[]; badMath: boolean } {
	const panels: PromptPanel[] = []
	let badMath = false
	const outByIndex = new Map(outputs.map((o) => [o.index, o]))
	const outs = legs.filter((l) => {
		if (l.side !== 'output' || l.isIndexerFee) return false
		if (isTokenLeg(l)) return true
		const eo = outByIndex.get(l.index)
		if (eo?.template === 'bsv21' || eo?.tokenAmt) return true
		if (eo?.lockingScript) {
			try {
				return BSV21.decode(Script.fromHex(eo.lockingScript)) != null
			} catch {
				return false
			}
		}
		return false
	})
	const ins = legs.filter((l) => l.side === 'input' && isTokenLeg(l))

	const resolveTokenId = (leg: TxLeg, eo?: EnrichedOutput) =>
		leg.tokenId ??
		eo?.tokenId ??
		tagFrom(leg.tags, 'bsv21') ??
		ins.map((i) => i.tokenId ?? tagFrom(i.tags, 'bsv21')).find(Boolean)

	const tokenIds = new Set<string>()
	for (const leg of [...ins, ...outs]) {
		const id = resolveTokenId(leg, outByIndex.get(leg.index))
		if (id && id !== 'deploy') tokenIds.add(id)
	}

	for (const tokenId of tokenIds) {
		const metaRow = tokenMeta[tokenId]
		const tIns = ins.filter(
			(i) => (i.tokenId ?? tagFrom(i.tags, 'bsv21')) === tokenId,
		)
		const tOuts = outs.filter((o) => {
			const eo = outByIndex.get(o.index)
			return resolveTokenId(o, eo) === tokenId
		})

		const symFromIn = tIns.map((i) => i.tokenSym).find(Boolean)
		const decFromIn = (() => {
			const raw = tIns.map((i) => tagFrom(i.tags, 'dec')).find(Boolean)
			if (raw == null) return undefined
			const n = Number.parseInt(raw, 10)
			return Number.isFinite(n) ? n : undefined
		})()
		const iconFromIn = tIns.map((i) => tagFrom(i.tags, 'icon')).find(Boolean)
		const sym =
			metaRow?.sym ??
			symFromIn ??
			tOuts
				.map((o) => o.tokenSym ?? outByIndex.get(o.index)?.tokenSym)
				.find(Boolean) ??
			tagFrom(tIns[0]?.tags, 'sym') ??
			'tokens'
		const dec =
			metaRow?.dec != null && Number.isFinite(metaRow.dec)
				? metaRow.dec
				: decFromIn
		const iconUrl =
			metaRow?.iconUrl ??
			(iconFromIn
				? (contentUrls[iconFromIn] ??
					contentUrls[iconFromIn.replace('_', '.')] ??
					undefined)
				: undefined)

		let inTotal = 0n
		for (const i of tIns) {
			inTotal += parseAmt(i.tokenAmt ?? tagFrom(i.tags, 'amt'))
		}

		// First pass: totals only.
		let sendTotal = 0n
		let changeTotal = 0n
		let mintLike = false
		const hasExternal = tOuts.some((o) => {
			const eo = outByIndex.get(o.index)
			return Boolean(o.recipient ?? eo?.recipient) && !(o.basket ?? eo?.basket)
		})

		type OutAcc = {
			leg: TxLeg
			eo?: EnrichedOutput
			amt: string
			amtN: bigint
			external: boolean
			recipient?: string
		}
		const issuances: OutAcc[] = []

		for (const leg of tOuts) {
			const eo = outByIndex.get(leg.index)
			const basket = leg.basket ?? eo?.basket
			const recipient = leg.recipient ?? eo?.recipient
			const external = Boolean(recipient) && !basket
			const selfKeep = basket === BSV21_BASKET
			const op = leg.tokenOp ?? eo?.tokenOp
			if (isMintOp(op)) mintLike = true

			const amt = tokenAmtFromOutput(eo, leg)
			if (!amt) {
				consumed.add(legKey(leg))
				continue
			}
			const amtN = parseAmt(amt)

			if (op?.toLowerCase() === 'burn') {
				consumed.add(legKey(leg))
				continue
			}

			if (selfKeep && hasExternal) {
				changeTotal += amtN
				consumed.add(legKey(leg))
				continue
			}
			if (!external && !selfKeep) {
				consumed.add(legKey(leg))
				continue
			}

			if (external) sendTotal += amtN
			else changeTotal += amtN

			issuances.push({ leg, eo, amt, amtN, external, recipient })
			consumed.add(legKey(leg))
		}

		const outTotal = sendTotal + changeTotal
		const tokenBadMath = !mintLike && inTotal > 0n && outTotal > inTotal
		if (tokenBadMath) badMath = true

		if (tokenBadMath) {
			// Burn only — over-issue Move/Send is irrelevant for approval.
			panels.push({
				variant: 'token',
				tone: 'danger',
				previewKind: iconUrl ? 'image' : 'none',
				...(iconUrl ? { imageUrl: iconUrl } : {}),
				title: 'Burn',
				subtitle: `${formatTokenAmt(inTotal.toString(), dec ?? 0)} ${sym}`,
				meta: [
					{ key: 'Note', value: 'outputs > inputs' },
					copyable('Token', tokenId),
				],
			})
		} else {
			for (const iss of issuances) {
				const displayAmt = formatTokenAmt(iss.amt, dec ?? 0)
				const meta: PromptDetailRow[] = []
				if (iss.recipient && iss.external) {
					meta.push(copyable('To', iss.recipient))
				}
				meta.push(copyable('Token', tokenId))
				panels.push({
					variant: 'token',
					previewKind: iconUrl ? 'image' : 'none',
					...(iconUrl ? { imageUrl: iconUrl } : {}),
					title: iss.external ? 'Send' : 'Move',
					subtitle: `${displayAmt} ${sym}`,
					meta,
				})
			}

			if (!mintLike && inTotal > outTotal) {
				const burned = inTotal - outTotal
				panels.push({
					variant: 'token',
					tone: 'danger',
					previewKind: iconUrl ? 'image' : 'none',
					...(iconUrl ? { imageUrl: iconUrl } : {}),
					title: 'Burn',
					subtitle: `${formatTokenAmt(burned.toString(), dec ?? 0)} ${sym}`,
					meta: [
						{ key: 'Note', value: 'inputs > outputs' },
						copyable('Token', tokenId),
					],
				})
			}
		}
	}

	for (const inp of ins) {
		consumed.add(legKey(inp))
	}

	return { panels, badMath }
}

function panelFromValueLeg(leg: TxLeg): PromptPanel | undefined {
	const sats = leg.satoshis
	if (!(sats > 0)) return undefined
	// Overlay fee is shown once under indexerFee — never as Pay.
	if (leg.isIndexerFee) return undefined
	if (leg.tags?.includes('fee:overlay')) return undefined
	if (leg.tags?.some((t) => t.startsWith('indexer-fee'))) return undefined

	if (leg.side === 'output' && leg.template === 'lock') {
		const meta: PromptDetailRow[] = []
		if (leg.lockUntilHeight != null) {
			meta.push({
				key: 'Until',
				value: `height ${leg.lockUntilHeight.toLocaleString('en-US')}`,
			})
		}
		return {
			variant: 'value',
			previewKind: 'none',
			valueIcon: 'lock',
			amountSats: sats,
			title: 'Lock',
			subtitle: formatSatsFull(sats),
			meta,
		}
	}

	if (
		leg.side === 'input' &&
		(leg.basket === LOCK_BASKET || leg.basket?.includes('lock'))
	) {
		return {
			variant: 'value',
			previewKind: 'none',
			valueIcon: 'unlock',
			amountSats: sats,
			title: 'Unlock',
			subtitle: formatSatsFull(sats),
		}
	}

	if (
		leg.side === 'output' &&
		leg.template === 'p2pkh' &&
		leg.recipient &&
		!leg.basket &&
		sats > 1
	) {
		return {
			variant: 'value',
			previewKind: 'none',
			valueIcon: 'pay',
			amountSats: sats,
			title: 'Pay',
			subtitle: formatSatsFull(sats),
			meta: [copyable('To', leg.recipient)],
		}
	}

	return undefined
}

function panelFromOrdinalEdge(
	edge: OrdinalEdge,
	contentUrls: Record<string, string>,
): PromptPanel {
	const assetName = edge.spend?.name ?? edge.create?.name
	const profileName = edge.create?.opnsProfileName
	const origin = edge.create?.origin ?? edge.spend?.origin
	const contentType =
		edge.create?.contentType ??
		contentTypeFromTags(edge.create?.tags) ??
		contentTypeFromTags(edge.spend?.tags)

	let actionTitle = 'Update'
	const meta: PromptDetailRow[] = []

	switch (edge.operation) {
		case 'transfer':
			actionTitle = edge.create?.recipient ? 'Send' : 'Move'
			if (edge.create?.recipient) {
				meta.push(copyable('To', edge.create.recipient))
			}
			break
		case 'list': {
			actionTitle = 'List'
			const price = edge.create?.listingPriceSats
			if (price != null) {
				meta.push({
					key: 'Price',
					value: `${price.toLocaleString('en-US')} sats`,
				})
			}
			if (edge.create?.listingSeller) {
				meta.push(copyable('Payout', edge.create.listingSeller))
			}
			break
		}
		case 'cancel-listing':
			actionTitle = 'Cancel listing'
			break
		case 'purchase': {
			actionTitle = 'Buy'
			const price = edge.create?.listingPriceSats
			if (price != null) {
				meta.push({
					key: 'Price',
					value: `${price.toLocaleString('en-US')} sats`,
				})
			}
			break
		}
		case 'inscribe':
			actionTitle = 'Inscribe'
			if (
				edge.create?.sealPending ||
				edge.create?.sealKind === 'sigma' ||
				edge.create?.template === 'sigma'
			) {
				meta.push({
					key: 'Sign',
					value:
						edge.create.sealKind === 'sigma' ||
						edge.create.template === 'sigma'
							? 'BAP identity (Sigma)'
							: 'Script data',
				})
			}
			break
		case 'register':
			actionTitle = 'Publish'
			if (edge.create?.sealPending || edge.create?.sealKind === 'pushdrop') {
				meta.push({ key: 'Sign', value: 'PushDrop identity bind' })
			}
			break
		case 'unregister':
			actionTitle = 'Unpublish'
			break
		case 'burn':
			actionTitle = 'Burn'
			break
	}

	if (origin) {
		meta.unshift(copyable('Origin', origin))
	}

	const isOpns =
		edge.operation === 'register' ||
		edge.operation === 'unregister' ||
		Boolean(profileName) ||
		edge.spend?.basket === OPNS_BASKET ||
		Boolean(edge.spend?.basket?.includes('opns'))

	const avatarOrigin = edge.create?.opnsAvatarOrigin?.trim()
	const avatarUrl =
		avatarOrigin && contentUrls[avatarOrigin]
			? contentUrls[avatarOrigin]
			: undefined
	const originUrl = origin ? contentUrls[origin] : undefined

	if (isOpns) {
		return {
			variant: 'ordinal',
			previewKind: 'opns',
			...(avatarUrl ? { imageUrl: avatarUrl } : {}),
			title: actionTitle,
			...(assetName ? { subtitle: assetName } : {}),
			...(profileName ? { opnsHero: profileName } : {}),
			meta,
		}
	}

	const contentTypeResolved =
		edge.create?.contentType ?? contentType
	const previewKind = previewKindFromContentType(contentTypeResolved)
	const inlineText = edge.create?.inscriptionText
	const inlineImage = edge.create?.inscriptionDataUrl
	const mediaUrl = inlineImage ?? originUrl
	return {
		variant: 'ordinal',
		previewKind: mediaUrl && previewKind === 'none' ? 'image' : previewKind,
		...(inlineText ? { previewText: inlineText } : {}),
		...(previewKind === 'image' || (previewKind === 'none' && mediaUrl)
			? mediaUrl
				? { imageUrl: mediaUrl }
				: {}
			: mediaUrl
				? { contentUrl: mediaUrl }
				: {}),
		title: actionTitle,
		...(assetName ? { subtitle: assetName } : {}),
		meta,
	}
}
