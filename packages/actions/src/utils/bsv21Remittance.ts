/**
 * BRC-163-oriented BSV-21 remittance helpers.
 * CI = load-bearing token fields + derivation; tags = exact listOutputs filters.
 *
 * Deploy outs: tag `bsv21:deploy` only (token id = that outpoint). After spend,
 * tips use `bsv21:<tokenId>`. Balance/selection treat deploy outpoint as id.
 */

import { formatOrdinalOutpoint } from '@1sat/types'

export type Bsv21RemittanceFields = {
	/** Token id (deploy outpoint). Omit on deploy (id = outpoint at read time). */
	id?: string
	amt: string
	op?: string
	sym?: string
	dec?: string | number
	icon?: string
}

/** Filter tags only (exact listOutputs match). */
export function bsv21FilterTags(opts: {
	/** When set, stamp `bsv21:<tokenId>`. Omit on bare deploy filing. */
	tokenId?: string
	deploy?: boolean
	auth?: boolean
}): string[] {
	const tags: string[] = []
	if (opts.tokenId) tags.push(`bsv21:${opts.tokenId}`)
	if (opts.deploy) tags.push('bsv21:deploy')
	if (opts.auth) tags.push('bsv21:auth')
	return tags
}

const DEPLOY_TAG = 'bsv21:deploy'
const AUTH_TAG = 'bsv21:auth'

/** CI: token fields + optional derivation. */
export function buildBsv21CustomInstructions(opts: {
	token: Bsv21RemittanceFields
	protocolID?: unknown
	keyID?: string
	counterparty?: string
	extra?: Record<string, unknown>
}): string {
	const { token } = opts
	const dec =
		token.dec === undefined || token.dec === null
			? undefined
			: String(token.dec)
	return JSON.stringify({
		...(token.id && { id: token.id }),
		amt: String(token.amt),
		...(token.op && { op: token.op }),
		...(token.sym && { sym: token.sym }),
		...(dec !== undefined && { dec }),
		...(token.icon && { icon: token.icon }),
		...(opts.protocolID !== undefined && { protocolID: opts.protocolID }),
		...(opts.keyID !== undefined && { keyID: opts.keyID }),
		...(opts.counterparty !== undefined && {
			counterparty: opts.counterparty,
		}),
		...opts.extra,
	})
}

/** Parse CI JSON; empty on failure. */
export function parseBsv21CustomInstructions(
	ci: string | undefined,
): Partial<Bsv21RemittanceFields> & {
	protocolID?: unknown
	keyID?: string
	counterparty?: string
} {
	if (!ci) return {}
	try {
		const o = JSON.parse(ci) as Record<string, unknown>
		return {
			...(typeof o.id === 'string' && { id: o.id }),
			...(typeof o.amt === 'string' && { amt: o.amt }),
			...(typeof o.op === 'string' && { op: o.op }),
			...(typeof o.sym === 'string' && { sym: o.sym }),
			...(typeof o.dec === 'string' && { dec: o.dec }),
			...(typeof o.icon === 'string' && { icon: o.icon }),
			...(o.protocolID !== undefined && { protocolID: o.protocolID }),
			...(typeof o.keyID === 'string' && { keyID: o.keyID }),
			...(typeof o.counterparty === 'string' && {
				counterparty: o.counterparty,
			}),
		}
	} catch {
		return {}
	}
}

/**
 * Resolve token id / amt for a wallet row: CI → tags → deploy outpoint.
 * Token id is never the BRC-164 `id:` list key.
 */
export function bsv21FieldsFromOutput(o: {
	tags?: string[]
	customInstructions?: string
	/** Wire outpoint; used when tagged bsv21:deploy (id = this outpoint). */
	outpoint?: string
}): {
	tokenId?: string
	amt?: string
	sym?: string
	dec?: string
	icon?: string
	isDeploy?: boolean
	isAuth?: boolean
} {
	const ci = parseBsv21CustomInstructions(o.customInstructions)
	const tags = o.tags ?? []
	const isDeploy = tags.some((t) => t.toLowerCase() === DEPLOY_TAG)
	const isAuth = tags.some((t) => t.toLowerCase() === AUTH_TAG)

	let tokenId = ci.id
	if (!tokenId) {
		const t = tags.find((x) => {
			const n = x.toLowerCase()
			return n.startsWith('bsv21:') && n !== DEPLOY_TAG && n !== AUTH_TAG
		})
		if (t) tokenId = t.slice(6)
	}
	if (!tokenId && isDeploy && o.outpoint) {
		tokenId = formatOrdinalOutpoint(o.outpoint)
	}

	let amt = ci.amt
	if (!amt) {
		const t = tags.find((x) => x.startsWith('amt:'))
		if (t) amt = t.slice(4)
	}

	let sym = ci.sym
	if (!sym) {
		const t = tags.find((x) => x.startsWith('sym:'))
		if (t) sym = t.slice(4)
	}

	let dec = typeof ci.dec === 'string' ? ci.dec : undefined
	if (!dec) {
		const t = tags.find((x) => x.startsWith('dec:'))
		if (t) dec = t.slice(4)
	}

	let icon = ci.icon
	if (!icon) {
		const t = tags.find((x) => x.startsWith('icon:'))
		if (t) icon = t.slice(5)
	}

	return {
		...(tokenId && { tokenId }),
		...(amt && { amt }),
		...(sym && { sym }),
		...(dec && { dec }),
		...(icon && { icon }),
		...(isDeploy && { isDeploy: true }),
		...(isAuth && { isAuth: true }),
	}
}

/** Normalize token id / outpoint for equality (underscore form). */
export function normalizeBsv21TokenId(id: string): string {
	return formatOrdinalOutpoint(id.trim())
}

/**
 * Overwrite load-bearing BSV-21 fields on existing CI JSON.
 * Keeps all other keys (derivation, extras). Only sets fields present on `auth`.
 */
export function overwriteBsv21CiFields(
	existingJson: string,
	auth: Partial<Bsv21RemittanceFields>,
): string {
	const o = JSON.parse(existingJson) as Record<string, unknown>
	if (auth.id !== undefined) o.id = auth.id
	if (auth.amt !== undefined) o.amt = String(auth.amt)
	if (auth.op !== undefined) o.op = auth.op
	if (auth.sym !== undefined) o.sym = auth.sym
	if (auth.dec !== undefined && auth.dec !== null) o.dec = String(auth.dec)
	if (auth.icon !== undefined) o.icon = auth.icon
	return JSON.stringify(o)
}
