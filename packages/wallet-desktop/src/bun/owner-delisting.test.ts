import { describe, expect, test } from 'bun:test'
import type { OneSatServices } from '@1sat/client'
import { OrdLockV2 } from '@1sat/templates'
import { OPNS_BASKET, ORDINALS_BASKET } from '@1sat/types'
import {
	P2PKH,
	Script,
	Transaction,
	type WalletInterface,
	type WalletOutput,
} from '@bsv/sdk'
import {
	ownedListing,
	parseListing,
} from '../mainview/views/ordinal-detail/listing.js'
import {
	findOwnedOrdinal,
	listOwnedOutputs,
	scanSweepAssets,
} from './owner-delisting.js'

type TxoStreamEvent = ReturnType<
	OneSatServices['owner']['getTxos']
> extends AsyncGenerator<infer Event>
	? Event
	: never

// OrdLock v2 listing by the seller; no private keys or signing.
const seller = '1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2'
const listingHex = OrdLockV2.lock(seller, seller, 1000).toHex()
const zeroPriceListingHex = OrdLockV2.lock(seller, seller, 0).toHex()

function servicesFor(tx: Transaction, events?: TxoStreamEvent[]) {
	const txid = tx.id('hex')
	let rawCalls = 0
	const stream = events ?? [
		...tx.outputs.map((_, vout) => ({
			type: 'txo' as const,
			data: { outpoint: `${txid}.${vout}`, score: vout },
		})),
		{ type: 'done' as const },
	]
	const services = {
		owner: {
			async *getTxos(address: string, options: unknown) {
				expect(address).toBe(seller)
				expect(options).toEqual({
					refresh: true,
					unspent: true,
					events: true,
					sats: true,
					limit: 0,
				})
				yield* stream
			},
		},
		beef: {
			async getRawTx(id: string) {
				expect(id).toBe(txid)
				rawCalls++
				return new Uint8Array(tx.toBinary())
			},
		},
	} as unknown as OneSatServices
	return { services, rawCalls: () => rawCalls }
}

function row(index: number): WalletOutput {
	return {
		outpoint: `${index.toString(16).padStart(64, '0')}.0`,
		satoshis: 1,
		spendable: true,
		tags: ['ordlock2', `id:${index}`],
	}
}

describe('desktop owner delisting discovery', () => {
	test('finds owner outputs beyond 200 and 1000, including the OpNS basket', async () => {
		const ordinals = Array.from({ length: 1201 }, (_, index) => row(index))
		const names = Array.from({ length: 231 }, (_, index) => row(2000 + index))
		const offsets: number[] = []
		const wallet = {
			async listOutputs({
				basket,
				offset = 0,
				limit = 100,
			}: { basket: string; offset?: number; limit?: number }) {
				offsets.push(offset)
				const rows = basket === ORDINALS_BASKET ? ordinals : names
				const outputs = rows.slice(offset, offset + limit)
				return {
					outputs,
					// Installed toolbox reports page length on a short final page.
					totalOutputs: outputs.length < limit ? outputs.length : rows.length,
				}
			},
		} as unknown as WalletInterface
		const ordinal = await findOwnedOrdinal(
			wallet,
			ordinals[1200].outpoint.replace('.', '_'),
		)
		expect(ordinal?.output).toEqual(ordinals[1200])
		const name = await findOwnedOrdinal(wallet, names[230].outpoint)
		expect(name?.basket).toBe(OPNS_BASKET)
		expect(name?.output).toEqual(names[230])
		expect(offsets).toContain(1200)
	})
	test('refuses repeated pages instead of silently stopping', async () => {
		const wallet = {
			async listOutputs() {
				return { outputs: [row(1)], totalOutputs: 2 }
			},
		} as unknown as WalletInterface
		await expect(listOwnedOutputs(wallet, ORDINALS_BASKET)).rejects.toThrow(
			'did not advance',
		)
	})
	test('collects a complete refreshed snapshot past 1000 and decodes untagged zero-price listings', async () => {
		const tx = new Transaction()
		for (let index = 0; index < 1005; index++)
			tx.addOutput({ lockingScript: new P2PKH().lock(seller), satoshis: 2 })
		tx.addOutput({
			lockingScript: Script.fromHex(zeroPriceListingHex),
			satoshis: 1,
		})
		const fixture = servicesFor(tx)
		const result = await scanSweepAssets(fixture.services, seller)
		expect(result.funding).toHaveLength(1005)
		expect(result.listings).toHaveLength(1)
		expect(result.totalSats).toBe(2010)
		expect(fixture.rawCalls()).toBe(1)
	})
	test('deduplicates outpoints across equivalent separator forms', async () => {
		const tx = new Transaction()
		tx.addOutput({ lockingScript: Script.fromHex(listingHex), satoshis: 1 })
		const id = tx.id('hex')
		const fixture = servicesFor(tx, [
			{ type: 'txo', data: { outpoint: `${id}.0`, score: 0 } },
			{ type: 'txo', data: { outpoint: `${id}_0`, score: 0 } },
			{ type: 'done' },
		])
		expect(
			(await scanSweepAssets(fixture.services, seller)).listings,
		).toHaveLength(1)
	})
	test('SSE errors and missing completion refuse a partial scan before reading scripts', async () => {
		const tx = new Transaction()
		tx.addOutput({ lockingScript: new P2PKH().lock(seller), satoshis: 100 })
		for (const errorEvent of [true, false]) {
			const events: TxoStreamEvent[] = [
				{ type: 'txo', data: { outpoint: `${tx.id('hex')}.0`, score: 0 } },
			]
			if (errorEvent)
				events.push({ type: 'error', error: new Error('offline failure') })
			const fixture = servicesFor(tx, events)
			await expect(scanSweepAssets(fixture.services, seller)).rejects.toThrow()
			expect(fixture.rawCalls()).toBe(0)
		}
	})
	test('metadata/script conflicts cannot become funding outputs', async () => {
		const tx = new Transaction()
		tx.addOutput({ lockingScript: new P2PKH().lock(seller), satoshis: 100 })
		const fixture = servicesFor(tx, [
			{
				type: 'txo',
				data: { outpoint: `${tx.id('hex')}.0`, score: 0, events: ['ordlock2'] },
			},
			{ type: 'done' },
		])
		await expect(scanSweepAssets(fixture.services, seller)).rejects.toThrow(
			'metadata does not match',
		)
	})
	test('current market object and wallet tags keep zero/unknown-price listings cancellable', () => {
		expect(
			parseListing({
				outpoint: 'listing.0',
				data: { ordlock: { price: 0, origin: 'origin.0' } },
			}),
		).toEqual({ outpoint: 'listing.0', origin: 'origin.0', priceSats: 0 })
		expect(parseListing([{ outpoint: 'obsolete-array' }])).toBeNull()
		expect(ownedListing({ ...row(1), tags: ['ordlock2'] })).not.toBeNull()
		expect(ownedListing({ ...row(1), tags: ['price:1'] })).toBeNull()
	})
})

test('malformed wallet inventory totals cannot become complete discovery', async () => {
	for (const totalOutputs of [
		undefined,
		-1,
		0.5,
		Number.NaN,
		Number.POSITIVE_INFINITY,
	]) {
		const wallet = {
			listOutputs: async () => ({ totalOutputs, outputs: [] }),
		} as unknown as WalletInterface
		await expect(listOwnedOutputs(wallet, ORDINALS_BASKET)).rejects.toThrow(
			'invalid total',
		)
	}
	const overcount = {
		listOutputs: async () => ({ totalOutputs: 1, outputs: [row(1), row(2)] }),
	} as unknown as WalletInterface
	await expect(listOwnedOutputs(overcount, ORDINALS_BASKET)).rejects.toThrow(
		'exceeded its total',
	)
})
