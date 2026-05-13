/**
 * Shared BEEF internalization pipeline.
 *
 * Takes raw BEEF bytes, parses the transaction with indexers to determine
 * basket/tags/protocol, builds InternalizeOutput entries, and calls
 * wallet.internalizeAction().
 *
 * Used by both address sync (external deposits) and message box sync (paymail payments).
 */

import { OrdLock } from '@1sat/templates'
import type { OneSatServices } from '@1sat/client'
import type { Indexer, ParseContext, Txo } from '@1sat/types'
import {
	BSV21_BASKET,
	DEPOSIT_BASKET,
	ORDINALS_BASKET,
	buildTokenLabel,
} from '@1sat/types'
import {
	Bsv21Indexer,
	CosignIndexer,
	FundIndexer,
	InscriptionIndexer,
	MapIndexer,
	OpNSIndexer,
	OrdLockIndexer,
	OriginIndexer,
	Outpoint,
	SigmaIndexer,
} from '@1sat/wallet'
import {
	Beef,
	type InternalizeActionArgs,
	type InternalizeOutput,
	Transaction,
	type WalletCounterparty,
	type WalletInterface,
} from '@bsv/sdk'
import { randomActionId } from './createTrackedAction'

// ============================================================================
// Types
// ============================================================================

/** A single output to internalize, with its derivation info. */
export interface OutputDerivation {
	outputIndex: number
	derivationPrefix: string
	derivationSuffix: string
	senderIdentityKey: string
	/**
	 * Protocol the receiver derived under — recorded verbatim in the
	 * output's customInstructions so signP2PKHInput later derives the
	 * matching spend key.
	 *
	 * Different inputs can carry different protocols (e.g. legacy BRC-29
	 * receive addresses vs. new P1SAT-derived ones); callers must specify
	 * the actual protocol used to derive the address.
	 */
	protocolID: [0 | 1 | 2, string]
	/**
	 * Counterparty the receiver derived under. Defaults to `'self'` when
	 * omitted — BRC-43/BRC-29 receive addresses created with `forSelf:true`
	 * use the wallet's own identity as the counterparty.
	 */
	counterparty?: WalletCounterparty
}

export interface InternalizeBeefOptions {
	/** Raw BEEF bytes */
	beef: Uint8Array
	/** Wallet for calling internalizeAction */
	wallet: WalletInterface
	/** Services for loading source transactions and running indexers */
	services: OneSatServices
	/** Network chain */
	chain: 'main' | 'test'
	/**
	 * Explicit output derivations by vout index (message box sync).
	 * Provide either `outputs` or `addressDerivations`, not both.
	 */
	outputs?: OutputDerivation[]
	/**
	 * Address-based derivation lookup (address sync).
	 * Maps owner address → derivation info. After indexer parsing,
	 * txo.owner is matched against this map.
	 */
	addressDerivations?: Map<string, OutputDerivation>
}

export interface InternalizeBeefResult {
	txid: string
	internalized: number
}

// ============================================================================
// Main function
// ============================================================================

export async function internalizeBeef(
	opts: InternalizeBeefOptions,
): Promise<InternalizeBeefResult> {
	const { beef, wallet, services, chain, outputs, addressDerivations } = opts

	if (!outputs && !addressDerivations) {
		throw new Error('Either outputs or addressDerivations must be provided')
	}

	const beefObj = Beef.fromBinary(Array.from(beef))
	const txids = beefObj.txs
		.filter((btx) => btx.tx != null)
		.map((btx) => btx.tx!.id('hex'))
	const mainTxid = txids[txids.length - 1]

	const btx = beefObj.findTxid(mainTxid)
	if (!btx?.tx) {
		throw new Error('Transaction not found in BEEF')
	}

	// Ensure source transactions are loaded for inputs
	for (const input of btx.tx.inputs) {
		if (!input.sourceTransaction && input.sourceTXID) {
			const rawTx = await services.beef.getRawTx(input.sourceTXID)
			input.sourceTransaction = Transaction.fromBinary(Array.from(rawTx))
		}
	}

	// Build vout lookup for explicit output mode
	const derivationByVout = new Map<number, OutputDerivation>()
	if (outputs) {
		for (const out of outputs) {
			derivationByVout.set(out.outputIndex, out)
		}
	}

	// Build indexers
	const owners = new Set<string>(
		addressDerivations ? addressDerivations.keys() : [],
	)
	const network = chain === 'main' ? 'mainnet' : 'testnet'
	const indexers: Indexer[] = [
		new FundIndexer(owners, network),
		new InscriptionIndexer(owners, network),
		new Bsv21Indexer(owners, network, services),
		new CosignIndexer(owners, network),
		new OriginIndexer(owners, network, services),
		new OpNSIndexer(owners, network),
		new OrdLockIndexer(owners, network),
		new SigmaIndexer(owners, network),
		new MapIndexer(owners, network),
	]

	// Parse transaction with indexers
	const parseCtx = await parseTransaction(btx.tx, indexers)

	// Relinquish any of our listings that were purchased by this tx. Cancels
	// are signed by us — wallet.signAction already marked the listing input
	// spent — so we only act on purchases. Detected by inspecting the input's
	// unlocking script via OrdLock.isPurchase(); basket is BSV21_BASKET if
	// the listing wrapped a BSV21 token, ORDINALS_BASKET otherwise.
	for (let vin = 0; vin < parseCtx.spends.length; vin++) {
		const spend = parseCtx.spends[vin]
		if (!spend.data.list) continue
		const unlockingScript = btx.tx.inputs[vin].unlockingScript
		if (!unlockingScript || !OrdLock.isPurchase(unlockingScript)) continue
		const basket = spend.data.bsv21 ? BSV21_BASKET : ORDINALS_BASKET
		try {
			await wallet.relinquishOutput({
				basket,
				output: spend.outpoint.toString(),
			})
		} catch {
			// Listing not in this wallet (we weren't the seller); nothing to relinquish.
		}
	}

	// Build InternalizeOutput entries
	const internalizeOutputs: InternalizeOutput[] = []
	const ownedTxos: Txo[] = []
	const actionId = randomActionId()

	for (const txo of parseCtx.txos) {
		// Resolve derivation: explicit vout match OR owner-address match
		const derivation =
			derivationByVout.get(txo.outpoint.vout) ||
			(txo.owner && addressDerivations?.get(txo.owner)) ||
			null
		if (!derivation) continue

		const result = buildInternalizeOutput(txo, derivation, actionId)
		if (result) {
			internalizeOutputs.push(result)
			ownedTxos.push(txo)
		}
	}

	if (internalizeOutputs.length === 0) {
		return { txid: mainTxid, internalized: 0 }
	}

	const labels = buildLabels(ownedTxos)

	const args: InternalizeActionArgs = {
		tx: Array.from(beef),
		outputs: internalizeOutputs,
		description: buildDescription(ownedTxos),
		...(labels.length > 0 && { labels }),
	}

	await wallet.internalizeAction(args)
	return { txid: mainTxid, internalized: internalizeOutputs.length }
}

// ============================================================================
// Internals
// ============================================================================

async function parseTransaction(
	tx: Transaction,
	indexers: Indexer[],
): Promise<ParseContext> {
	const txid = tx.id('hex')

	const ctx: ParseContext = {
		tx,
		txid,
		txos: [],
		spends: [],
		summary: {},
		indexers,
	}

	// Parse inputs into spends
	for (let vin = 0; vin < tx.inputs.length; vin++) {
		const input = tx.inputs[vin]
		if (!input.sourceTransaction) {
			throw new Error(`Missing sourceTransaction for input ${vin}`)
		}
		const sourceTxid = input.sourceTransaction.id('hex')
		const txo: Txo = {
			output: input.sourceTransaction.outputs[input.sourceOutputIndex],
			outpoint: new Outpoint(sourceTxid, input.sourceOutputIndex),
			data: {},
		}

		for (const indexer of indexers) {
			const result = await indexer.parse(txo)
			if (result) {
				txo.data[indexer.tag] = {
					data: result.data,
					tags: result.tags,
					content: result.content,
				}
				if (result.owner && !txo.owner) txo.owner = result.owner
				if (result.basket && !txo.basket) txo.basket = result.basket
			}
		}

		ctx.spends.push(txo)
	}

	// Parse each output
	for (let vout = 0; vout < tx.outputs.length; vout++) {
		const output = tx.outputs[vout]
		const txo: Txo = {
			output,
			outpoint: new Outpoint(txid, vout),
			data: {},
		}

		for (const indexer of indexers) {
			const result = await indexer.parse(txo)
			if (result) {
				txo.data[indexer.tag] = {
					data: result.data,
					tags: result.tags,
					content: result.content,
				}
				if (result.owner && !txo.owner) txo.owner = result.owner
				if (result.basket && !txo.basket) txo.basket = result.basket
				if (result.protocol && !txo.protocol) txo.protocol = result.protocol
			}
		}

		ctx.txos.push(txo)
	}

	// Summarize phase
	for (const indexer of indexers) {
		const summary = await indexer.summarize(ctx, true)
		if (summary) {
			ctx.summary[indexer.tag] = summary
		}
	}

	return ctx
}

function buildInternalizeOutput(
	txo: Txo,
	derivation: OutputDerivation,
	actionId: string,
): InternalizeOutput | null {
	const vout = txo.outpoint.vout
	const protocol = txo.protocol || 'wallet payment'
	// Per-output id: combines the per-action discriminator with the vout
	// so listOutputs lookups by tag resolve to exactly one record. See
	// applyTrackingTags in createTrackedAction.ts for the parallel.
	const idTag = `id:${actionId}_${vout}`

	if (protocol === 'basket insertion') {
		const basket = txo.basket || 'custom'
		const tags = [...collectTags(txo), idTag]
		const nameTag = tags.find((t) => t.startsWith('name:'))
		const sym = (txo.data.bsv21?.data as { sym?: string })?.sym

		return {
			outputIndex: vout,
			protocol: 'basket insertion',
			insertionRemittance: {
				basket,
				tags,
				customInstructions: JSON.stringify({
					derivationPrefix: derivation.derivationPrefix,
					derivationSuffix: derivation.derivationSuffix,
					senderIdentityKey: derivation.senderIdentityKey,
					...(nameTag && { name: nameTag.slice(5).slice(0, 64) }),
					...(sym && { sym }),
				}),
			},
		}
	}

	// P2PKH 1Sat asset (ordinals/tokens) — basket insertion so the wallet
	// records the spend protocol/keyID for later signing. protocolID +
	// counterparty come straight from the caller-supplied derivation so
	// signP2PKHInput derives the matching key (caller knows whether the
	// receive address was P1SAT-derived, BRC-29-derived, etc.).
	if (txo.basket && txo.basket !== 'fund') {
		const tags = [...collectTags(txo), idTag]
		const nameTag = tags.find((t) => t.startsWith('name:'))
		const sym = (txo.data.bsv21?.data as { sym?: string })?.sym

		return {
			outputIndex: vout,
			protocol: 'basket insertion',
			insertionRemittance: {
				basket: txo.basket,
				tags,
				customInstructions: JSON.stringify({
					protocolID: derivation.protocolID,
					keyID: `${derivation.derivationPrefix} ${derivation.derivationSuffix}`,
					...(derivation.counterparty != null && {
						counterparty: derivation.counterparty,
					}),
					...(nameTag && { name: nameTag.slice(5).slice(0, 64) }),
					...(sym && { sym }),
				}),
			},
		}
	}

	// Plain BSV at the user's deposit address — park in the deposit basket
	// for the sweep helper to pick up. customInstructions record the
	// caller-supplied protocol/counterparty so the sweep signs correctly.
	return {
		outputIndex: vout,
		protocol: 'basket insertion',
		insertionRemittance: {
			basket: DEPOSIT_BASKET,
			tags: [idTag],
			customInstructions: JSON.stringify({
				protocolID: derivation.protocolID,
				keyID: `${derivation.derivationPrefix} ${derivation.derivationSuffix}`,
				...(derivation.counterparty != null && {
					counterparty: derivation.counterparty,
				}),
			}),
		},
	}
}

function collectTags(txo: Txo): string[] {
	const tags: string[] = []
	for (const indexData of Object.values(txo.data)) {
		tags.push(...indexData.tags)
	}
	return tags
}

function buildLabels(ownedTxos: Txo[]): string[] {
	const labels = new Set<string>()
	for (const txo of ownedTxos) {
		const bsv21 = txo.data.bsv21?.data as { id?: string } | undefined
		if (bsv21?.id) {
			labels.add(buildTokenLabel(bsv21.id))
		}
	}
	return [...labels]
}

function buildDescription(ownedTxos: Txo[]): string {
	const parts: string[] = []
	let sats = 0

	for (const txo of ownedTxos) {
		if (txo.data.bsv21) {
			const token = txo.data.bsv21.data as {
				amt: bigint
				dec: number
				sym?: string
			}
			const sym = token.sym || 'tokens'
			const amt = Number(token.amt) / 10 ** token.dec
			parts.push(`${amt} ${sym}`)
		} else if (txo.basket === '1sat') {
			parts.push('ordinal')
		} else if (txo.basket === 'opns') {
			parts.push('OPNS name')
		} else if (txo.basket === 'fund') {
			sats += Number(txo.output.satoshis || 0)
		}
	}

	if (sats > 0) {
		parts.push(`${sats} sats`)
	}

	if (parts.length === 0) return 'Received via sync'

	const desc = `Received ${parts.join(' + ')}`
	if (desc.length <= 50) return desc
	return `${desc.slice(0, 47)}...`
}
