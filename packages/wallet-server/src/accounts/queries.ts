/**
 * Query helpers that let the server's own wallet act as the storage-payment
 * ledger. Payments are BRC-29 internalizations tagged with a structured set
 * of transaction labels:
 *
 *   - `wallet-storage-payment` — anchor for discovery
 *   - `payer:<identityKey>`   — per-payer filter
 *   - `bytes:<bytesCovered>`  — capacity purchased, parsed on read
 *   - `block:<paidThrough>`   — last valid block, parsed on read
 *
 * Kept as label strings (not customInstructions / description JSON) because
 * (a) labels are indexed for listActions filtering, and (b) BRC-29 wallet-
 * payment internalize doesn't accept output tags or customInstructions
 * alongside `paymentRemittance`.
 */

import { Utils, type WalletInterface } from '@bsv/sdk'
import type { IdentityKey, NextPaymentDerivation } from './types.js'

export const PAYMENT_LABEL = 'wallet-storage-payment'

export function payerLabel(identityKey: IdentityKey): string {
	return `payer:${identityKey}`
}

export function bytesLabel(bytes: number): string {
	return `bytes:${bytes}`
}

export function blockLabel(block: number): string {
	return `block:${block}`
}

/** Structured view of a payment extracted from an action's labels. */
export interface PaymentRecord {
	txid: string
	bytesCovered: number
	paidThroughBlock: number
	satsPaid: number
}

function parsePaymentLabels(labels: string[]): {
	bytesCovered?: number
	paidThroughBlock?: number
} {
	let bytesCovered: number | undefined
	let paidThroughBlock: number | undefined
	for (const label of labels) {
		if (label.startsWith('bytes:')) {
			const n = Number(label.slice(6))
			if (Number.isFinite(n)) bytesCovered = n
		} else if (label.startsWith('block:')) {
			const n = Number(label.slice(6))
			if (Number.isFinite(n)) paidThroughBlock = n
		}
	}
	return { bytesCovered, paidThroughBlock }
}

/**
 * All storage-payment actions ever recorded for this payer, oldest first
 * (listActions orders by ascending transactionId).
 */
export async function listPaymentsForPayer(
	wallet: WalletInterface,
	identityKey: IdentityKey,
): Promise<PaymentRecord[]> {
	const { actions } = await wallet.listActions({
		labels: [PAYMENT_LABEL, payerLabel(identityKey)],
		labelQueryMode: 'all',
		includeLabels: true,
		limit: 10000,
	})
	const records: PaymentRecord[] = []
	for (const action of actions) {
		const { bytesCovered, paidThroughBlock } = parsePaymentLabels(
			action.labels ?? [],
		)
		if (bytesCovered == null || paidThroughBlock == null) continue
		records.push({
			txid: action.txid,
			bytesCovered,
			paidThroughBlock,
			satsPaid: action.satoshis,
		})
	}
	return records
}

export async function countPaymentsForPayer(
	wallet: WalletInterface,
	identityKey: IdentityKey,
): Promise<number> {
	const result = await wallet.listActions({
		labels: [PAYMENT_LABEL, payerLabel(identityKey)],
		labelQueryMode: 'all',
		limit: 1,
	})
	return result.totalActions
}

/**
 * Refund-credit model: a new payment always supersedes any prior payment,
 * so the most recent payment whose `paidThroughBlock > currentBlock` is the
 * one that governs current capacity. Returns undefined if there is no such
 * active payment.
 */
export async function latestActivePaymentForPayer(
	wallet: WalletInterface,
	identityKey: IdentityKey,
	currentBlock: number,
): Promise<PaymentRecord | undefined> {
	const records = await listPaymentsForPayer(wallet, identityKey)
	// listActions returns oldest first; walk from end for the latest.
	for (let i = records.length - 1; i >= 0; i--) {
		if (records[i].paidThroughBlock > currentBlock) return records[i]
	}
	return undefined
}

/** Static derivation prefix tag (before base64 encoding). */
const PAYMENT_DERIVATION_PREFIX_TAG = 'wallet-storage'

/**
 * Server-issued next-payment derivation for an identity. Prefix is constant;
 * suffix is the monotonic count of payments already recorded for the
 * identity (first payment uses "0").
 */
export async function nextPaymentDerivation(
	identityKey: IdentityKey,
	wallet: WalletInterface,
): Promise<NextPaymentDerivation> {
	const count = await countPaymentsForPayer(wallet, identityKey)
	return {
		derivationPrefix: Utils.toBase64(
			Array.from(new TextEncoder().encode(PAYMENT_DERIVATION_PREFIX_TAG)),
		),
		derivationSuffix: Utils.toBase64([
			(count >>> 24) & 0xff,
			(count >>> 16) & 0xff,
			(count >>> 8) & 0xff,
			count & 0xff,
		]),
	}
}
