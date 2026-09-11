import { isListedOutput } from '@1sat/actions'
import type { OneSatServices } from '@1sat/client'
import { OrdLock } from '@1sat/templates'
import { type IndexedOutput, OPNS_BASKET, ORDINALS_BASKET } from '@1sat/types'
import { parseOutpoint } from '@1sat/utils'
import {
	P2PKH,
	Transaction,
	type WalletInterface,
	type WalletOutput,
} from '@bsv/sdk'
import type { SweepScanResult } from '../shared/types.js'

/** Read every matching wallet row, without spending while offsets are moving. */
export async function listOwnedOutputs(
	wallet: WalletInterface,
	basket: string,
): Promise<WalletOutput[]> {
	const outputs = new Map<string, WalletOutput>()
	let offset = 0
	let total: number | undefined
	while (true) {
		const page = await wallet.listOutputs({
			basket,
			includeTags: true,
			includeCustomInstructions: true,
			limit: total === undefined ? 100 : Math.min(100, total - offset),
			offset,
		})
		if (!Number.isSafeInteger(page.totalOutputs) || page.totalOutputs < 0)
			throw new Error(
				'Wallet output inventory returned an invalid total. Retry.',
			)
		if (offset + page.outputs.length > page.totalOutputs)
			throw new Error('Wallet output inventory exceeded its total. Retry.')
		if (total === undefined) total = page.totalOutputs
		if (page.totalOutputs !== total)
			throw new Error('Wallet output inventory changed. Retry.')
		if (page.outputs.length === 0) {
			if (offset < page.totalOutputs)
				throw new Error('Wallet output discovery was incomplete. Retry.')
			return [...outputs.values()]
		}
		const previous = outputs.size
		for (const output of page.outputs) outputs.set(output.outpoint, output)
		if (outputs.size === previous)
			throw new Error('Wallet output discovery did not advance. Retry.')
		offset += page.outputs.length
		if (offset >= page.totalOutputs) {
			if (outputs.size < page.totalOutputs)
				throw new Error(
					'Wallet output discovery returned duplicate rows. Retry.',
				)
			return [...outputs.values()]
		}
	}
}

export async function findOwnedOrdinal(
	wallet: WalletInterface,
	outpoint: string,
) {
	const normalize = (value: string) => value.replace('_', '.')
	const target = normalize(outpoint)
	for (const basket of [ORDINALS_BASKET, OPNS_BASKET]) {
		const outputs = await listOwnedOutputs(wallet, basket)
		const output = outputs.find(
			(row) =>
				normalize(row.outpoint) === target ||
				row.tags?.some(
					(tag) =>
						tag.startsWith('origin:') && normalize(tag.slice(7)) === target,
				),
		)
		if (output) return { output, basket }
	}
	return null
}

/** Complete refreshed SSE snapshot; an error or early EOF must never permit a funding sweep. */
export async function scanSweepAssets(
	services: OneSatServices,
	address: string,
): Promise<SweepScanResult> {
	const outputs = new Map<string, IndexedOutput>()
	let complete = false
	for await (const event of services.owner.getTxos(address, {
		refresh: true,
		unspent: true,
		events: true,
		sats: true,
		limit: 0,
	})) {
		if (event.type === 'error') throw event.error
		if (event.type === 'done') {
			complete = true
			break
		}
		if (event.type === 'txo')
			outputs.set(event.data.outpoint.replace('_', '.'), event.data)
	}
	if (!complete)
		throw new Error('Address scan ended before completion. Retry scanning.')

	const result: SweepScanResult = {
		funding: [],
		ordinals: [],
		tokens: [],
		listings: [],
		totalSats: 0,
	}
	const transactions = new Map<string, Transaction>()
	const fundingScript = new P2PKH().lock(address).toHex()
	for (const output of outputs.values()) {
		const { txid, vout } = parseOutpoint(output.outpoint)
		let tx = transactions.get(txid)
		if (!tx) {
			const raw = await services.beef.getRawTx(txid)
			if (!raw?.length)
				throw new Error(
					`Unable to load output ${output.outpoint}. Retry scanning.`,
				)
			tx = Transaction.fromBinary(Array.from(raw))
			if (tx.id('hex') !== txid)
				throw new Error('Address scan returned a mismatched transaction.')
			transactions.set(txid, tx)
		}
		const source = tx.outputs[vout]
		if (!source?.lockingScript || source.satoshis === undefined)
			throw new Error(`Missing output ${output.outpoint}.`)
		const lockingScript = source.lockingScript.toHex()
		const listing = OrdLock.decode(source.lockingScript)
		if (listing) {
			if (listing.seller !== address || source.satoshis !== 1)
				throw new Error(
					`Unable to cancel listing ${output.outpoint} with this key.`,
				)
			result.listings.push({
				outpoint: output.outpoint,
				satoshis: source.satoshis,
				lockingScript,
			})
		} else if (isListedOutput(output)) {
			throw new Error(
				`Listing metadata does not match output ${output.outpoint}. Retry scanning.`,
			)
		} else if (lockingScript === fundingScript && source.satoshis > 1) {
			result.funding.push({
				outpoint: output.outpoint,
				satoshis: source.satoshis,
				lockingScript,
			})
			result.totalSats += source.satoshis
		}
	}
	return result
}

const listingQueues = new WeakMap<WalletInterface, Promise<unknown>>()

/** Auto and manual cancellation share one queue per captured wallet. */
export function serializeListingOperation<T>(
	wallet: WalletInterface,
	operation: () => Promise<T>,
): Promise<T> {
	const previous = listingQueues.get(wallet) ?? Promise.resolve()
	const result = previous.catch(() => {}).then(operation)
	listingQueues.set(wallet, result)
	void result
		.finally(() => {
			if (listingQueues.get(wallet) === result) listingQueues.delete(wallet)
		})
		.catch(() => {})
	return result
}

/** Bind native SDK calls to the captured wallet and stop before the next call. */
export function guardListingWallet(
	wallet: WalletInterface,
	assertCurrent: () => void,
): WalletInterface {
	return new Proxy(wallet, {
		get(target, property) {
			const value = Reflect.get(target, property, target)
			if (typeof value !== 'function') return value
			return (...args: unknown[]) => {
				assertCurrent()
				return value.apply(target, args)
			}
		},
	})
}
