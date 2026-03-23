import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { getStackUrl } from '../../sidecar-manager'

async function stackFetch(path: string): Promise<unknown> {
	const url = `${getStackUrl()}${path}`
	const res = await fetch(url, { signal: AbortSignal.timeout(10_000) })
	if (!res.ok)
		throw new Error(`1sat-stack ${res.status}: ${await res.text()}`)
	return res.json()
}

export function registerDataTools(server: McpServer): void {
	server.tool(
		'inscription_metadata',
		'Get on-chain metadata for an inscription by outpoint (txid_vout).',
		{ outpoint: z.string().describe('Outpoint in format txid_vout') },
		async ({ outpoint }) => {
			try {
				const data = await stackFetch(`/1sat/ordfs/metadata/${outpoint}`)
				return {
					content: [
						{ type: 'text', text: JSON.stringify(data, null, 2) },
					],
				}
			} catch (err) {
				return {
					content: [
						{
							type: 'text',
							text: err instanceof Error ? err.message : String(err),
						},
					],
					isError: true,
				}
			}
		},
	)

	server.tool(
		'ordinals_search',
		'Search for ordinals/inscriptions via the 1sat-stack index.',
		{
			query: z.string().optional().describe('Search query'),
			limit: z.number().optional().describe('Max results (default 20)'),
		},
		async ({ query, limit }) => {
			try {
				const params = new URLSearchParams()
				if (query) params.set('q', query)
				if (limit) params.set('limit', String(limit))
				const data = await stackFetch(`/1sat/ordlock/listings?${params}`)
				return {
					content: [
						{ type: 'text', text: JSON.stringify(data, null, 2) },
					],
				}
			} catch (err) {
				return {
					content: [
						{
							type: 'text',
							text: err instanceof Error ? err.message : String(err),
						},
					],
					isError: true,
				}
			}
		},
	)

	server.tool(
		'token_balances',
		'Get BSV21 token balances for an address.',
		{
			tokenId: z
				.string()
				.describe('Token ID (outpoint of the token deploy)'),
			address: z.string().describe('BSV address'),
		},
		async ({ tokenId, address }) => {
			try {
				const data = await stackFetch(
					`/1sat/bsv21/${tokenId}/script/${address}/balance`,
				)
				return {
					content: [
						{ type: 'text', text: JSON.stringify(data, null, 2) },
					],
				}
			} catch (err) {
				return {
					content: [
						{
							type: 'text',
							text: err instanceof Error ? err.message : String(err),
						},
					],
					isError: true,
				}
			}
		},
	)

	server.tool(
		'listing_lookup',
		'Look up an OrdLock marketplace listing by outpoint.',
		{
			outpoint: z.string().describe('Listing outpoint (txid_vout)'),
		},
		async ({ outpoint }) => {
			try {
				const data = await stackFetch(
					`/1sat/ordlock/listing/${outpoint}`,
				)
				return {
					content: [
						{ type: 'text', text: JSON.stringify(data, null, 2) },
					],
				}
			} catch (err) {
				return {
					content: [
						{
							type: 'text',
							text: err instanceof Error ? err.message : String(err),
						},
					],
					isError: true,
				}
			}
		},
	)
}
