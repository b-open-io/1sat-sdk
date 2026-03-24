import {
	createContext,
	getBsv21Balances,
	getOrdinals,
	resolveBapId,
	sendBsv,
} from '@1sat/actions'
import { BRC29_PROTOCOL_ID } from '@1sat/types'
import { PublicKey, Utils as SdkUtils } from '@bsv/sdk'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { getStatus, getWallet } from '../../wallet-manager'

function requireWallet() {
	const w = getWallet()
	if (!w) throw new Error('Wallet is locked — unlock via Touch ID first')
	return w
}

export function registerWalletTools(server: McpServer): void {
	server.tool(
		'wallet_status',
		'Get the current wallet status (initializing, no-wallet, locked, unlocked).',
		{},
		async () => {
			return {
				content: [
					{
						type: 'text',
						text: JSON.stringify({ status: getStatus() }),
					},
				],
			}
		},
	)

	server.tool(
		'wallet_balance',
		'Get the wallet BSV balance in satoshis.',
		{},
		async () => {
			try {
				const { wallet } = requireWallet()
				const result = await wallet.listOutputs({
					basket: 'default',
					include: 'locking scripts',
				})
				let confirmed = 0
				for (const output of result.outputs) {
					if (output.spendable) confirmed += output.satoshis
				}
				return {
					content: [
						{
							type: 'text',
							text: JSON.stringify({ confirmed, unconfirmed: 0 }),
						},
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
		'wallet_identity',
		'Get the wallet BAP identity (bapId and public key).',
		{},
		async () => {
			try {
				const w = requireWallet()
				const ctx = createContext(w.wallet, {
					services: w.services,
					chain: 'main',
				})
				const bapId = await resolveBapId(ctx)
				const prefix = SdkUtils.toBase64(
					Array.from(new TextEncoder().encode('1sat')),
				)
				const suffix = SdkUtils.toBase64([0, 0, 0, 0])
				const { publicKey } = await w.wallet.getPublicKey({
					protocolID: BRC29_PROTOCOL_ID,
					keyID: `${prefix} ${suffix}`,
					forSelf: true,
				})
				const address = PublicKey.fromString(publicKey).toAddress()
				return {
					content: [
						{
							type: 'text',
							text: JSON.stringify({ bapId, publicKey, address }),
						},
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
		'wallet_ordinals',
		'List ordinals owned by the wallet.',
		{
			limit: z.number().optional().describe('Max results (default 100)'),
			offset: z.number().optional().describe('Offset for pagination'),
		},
		async ({ limit, offset }) => {
			try {
				const w = requireWallet()
				const ctx = createContext(w.wallet, {
					services: w.services,
					chain: 'main',
				})
				const result = await getOrdinals.execute(ctx, {
					limit: limit ?? 100,
					offset: offset ?? 0,
				})
				const ordinals = result.outputs.map((o) => ({
					outpoint: o.outpoint,
					tags: o.tags ?? [],
					satoshis: o.satoshis,
				}))
				return {
					content: [
						{
							type: 'text',
							text: JSON.stringify({ ordinals }, null, 2),
						},
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
		'wallet_tokens',
		'List BSV21 token balances in the wallet.',
		{},
		async () => {
			try {
				const w = requireWallet()
				const ctx = createContext(w.wallet, {
					services: w.services,
					chain: 'main',
				})
				const balances = await getBsv21Balances.execute(ctx, {})
				const mapped = balances.map((b) => ({
					id: b.id,
					sym: b.sym,
					icon: b.icon,
					dec: b.dec,
					amt: b.amt,
				}))
				return {
					content: [
						{
							type: 'text',
							text: JSON.stringify({ balances: mapped }, null, 2),
						},
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
		'wallet_send_bsv',
		'Send BSV to an address. Requires the wallet to be unlocked.',
		{
			address: z.string().describe('Destination BSV address (starts with 1)'),
			satoshis: z.number().int().positive().describe('Amount in satoshis'),
		},
		async ({ address, satoshis }) => {
			try {
				const w = requireWallet()
				const ctx = createContext(w.wallet, {
					services: w.services,
					chain: 'main',
				})
				const result = await sendBsv.execute(ctx, {
					requests: [{ address, satoshis }],
				})
				if (result.error) throw new Error(result.error)
				return {
					content: [
						{
							type: 'text',
							text: JSON.stringify({ txid: result.txid }),
						},
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
