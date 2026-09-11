import { describe, expect, test } from 'bun:test'
import type { OneSatServices } from '@1sat/client'
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

// Shared Swift/TypeScript OrdLock vector; no private keys or signing.
const seller = '1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2'
const listingHex =
	'2097dfd76851bf465e8f715593b217714858bbe9570ff3bd5e33840a34e20ff0262102ba79df5f8ae7604a9830f03c7933028186aede0675a16f025dc4f8be8eec0382201008ce7480da41702918d1ec8e6849ba32b4d65b1e40dc669c31a1e6306b266c00001477bff20c60e522dfaa3350c39b030a5d004e839a2250c30000000000001976a91462e907b15cbf27d5425399ebf6f0fb50ebb88f1888ac615179547a75537a537a537a0079537a75527a527a7575615579008763567901c161517957795779210ac407f0e4bd44bfc207355a778b046225a7068fc59ee7eda43ad905aadbffc800206c266b30e6a1319c66dc401e5bd6b432ba49688eecd118297041da8074ce081059795679615679aa0079610079517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e01007e81517a75615779567956795679567961537956795479577995939521414136d08c5ed2bf3ba048afe6dcaebafeffffffffffffffffffffffffffffff00517951796151795179970079009f63007952799367007968517a75517a75517a7561527a75517a517951795296a0630079527994527a75517a6853798277527982775379012080517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e01205279947f7754537993527993013051797e527e54797e58797e527e53797e52797e57797e0079517a75517a75517a75517a75517a75517a75517a75517a75517a75517a75517a75517a75517a756100795779ac517a75517a75517a75517a75517a75517a75517a75517a75517a7561517a75517a756169587951797e58797eaa577961007982775179517958947f7551790128947f77517a75517a75618777777777777777777767557951876351795779a9876957795779ac777777777777777767006868'

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
		tags: ['ordlock', `id:${index}`],
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
			lockingScript: Script.fromHex(
				listingHex.replace('50c3000000000000', '0000000000000000'),
			),
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
				data: { outpoint: `${tx.id('hex')}.0`, score: 0, events: ['ordlock'] },
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
		expect(ownedListing({ ...row(1), tags: ['ordlock'] })).not.toBeNull()
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
