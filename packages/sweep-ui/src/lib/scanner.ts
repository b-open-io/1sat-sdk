import {
	scanAddresses as coreScanAddresses,
	type ScanProgress,
	type ScanResult,
	type TokenBalance,
} from '@1sat/actions'
import type { IndexedOutput } from '@1sat/types'
import { PrivateKey } from '@bsv/sdk'
import { getServices } from './services'

export type { ScanProgress, ScanResult, TokenBalance }

export interface EnrichedOrdinal extends IndexedOutput {
	origin?: string
	contentType?: string
	name?: string
	contentUrl: string
}

export interface ScannedAssets
	extends Omit<ScanResult, 'ordinals' | 'opnsNames'> {
	ordinals: EnrichedOrdinal[]
	opnsNames: EnrichedOrdinal[]
	bsv21Tokens: TokenBalance[]
	totalBsv: number
}

export function deriveAddress(wif: string): string {
	return PrivateKey.fromWif(wif.trim()).toPublicKey().toAddress()
}

function getEvent(events: string[], prefix: string): string | undefined {
	const e = events.find((ev) => ev.startsWith(prefix))
	return e ? e.slice(prefix.length) : undefined
}

function getEvents(events: string[], prefix: string): string[] {
	return events
		.filter((e) => e.startsWith(prefix))
		.map((e) => e.slice(prefix.length))
}

function enrichOrdinal(out: IndexedOutput): EnrichedOrdinal {
	const events = out.events ?? []
	const origin = getEvent(events, 'origin:')
	const types = getEvents(events, 'type:')
	const contentType = types.find((t) => t.includes('/')) ?? types[0]
	const name = getEvent(events, 'name:')
	const contentUrl = getServices().ordfs.getContentUrl(origin ?? out.outpoint, {
		raw: true,
	})

	return { ...out, origin, contentType, name, contentUrl }
}

function resolveIconUrl(tokenId: string, icon?: string): string {
	if (!icon) return ''
	let outpoint = icon
	if (icon.startsWith('_')) {
		const txid = tokenId.split('_')[0]
		outpoint = `${txid}${icon}`
	}
	return getServices().ordfs.getContentUrl(outpoint)
}

function enrichTokenBalances(tokens: TokenBalance[]): TokenBalance[] {
	return tokens.map((t) => ({
		...t,
		icon: resolveIconUrl(t.tokenId, t.icon),
	}))
}

export async function scanAddress(
	address: string,
	onProgress?: (p: ScanProgress) => void,
): Promise<ScannedAssets> {
	const result = await coreScanAddresses(getServices(), [address], onProgress)
	return toScannedAssets(result)
}

export async function scanAddresses(
	addresses: string[],
	onProgress?: (p: ScanProgress) => void,
): Promise<ScannedAssets> {
	const unique = [...new Set(addresses)]
	const result = await coreScanAddresses(getServices(), unique, onProgress)
	return toScannedAssets(result)
}

function toScannedAssets(result: ScanResult): ScannedAssets {
	return {
		funding: result.funding,
		ordinals: result.ordinals.map(enrichOrdinal),
		opnsNames: result.opnsNames.map(enrichOrdinal),
		bsv21Tokens: enrichTokenBalances(result.bsv21Tokens),
		bsv20Tokens: result.bsv20Tokens,
		locked: result.locked,
		run: result.run,
		totalFundingSats: result.totalFundingSats,
		totalBsv: result.totalFundingSats,
	}
}
