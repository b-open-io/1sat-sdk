/**
 * Raw legacy-to-legacy ordinal and BSV transfers.
 *
 * These build and sign transactions directly without wallet involvement.
 * Funding can come from legacy UTXOs (fully raw) or from a BRC-100 wallet
 * via createAction.
 */

import { parseOutpoint } from '@1sat/utils'
import { P2PKH, PrivateKey, Transaction } from '@bsv/sdk'
import type { OneSatContext } from '../types'
import type { SweepInput } from './types'

export interface LegacySendOrdinalsRequest {
	/** Ordinal UTXOs (1 sat each) */
	ordinals: SweepInput[]
	/** WIF private key controlling the ordinal inputs */
	wif: string
	/** Destination BSV address */
	destination: string
	/** Funding source */
	funding: { source: 'legacy'; inputs: SweepInput[] } | { source: 'wallet' }
}

export interface LegacySendResult {
	txid?: string
	tx?: number[]
	error?: string
}

/**
 * Transfer ordinals to a destination address using legacy funding.
 *
 * Builds a raw transaction: ordinal inputs map 1:1 to 1-sat outputs
 * at the destination. Funding inputs cover the fee with change back
 * to the source address.
 */
async function transferWithLegacyFunding(
	ctx: OneSatContext,
	ordinals: SweepInput[],
	fundingInputs: SweepInput[],
	privateKey: PrivateKey,
	destination: string,
): Promise<LegacySendResult> {
	if (!ctx.services) return { error: 'services-required' }

	const tx = new Transaction()
	const p2pkh = new P2PKH()
	const sourceAddress = privateKey.toPublicKey().toAddress()

	// Add ordinal inputs — order matters for satoshi position mapping
	for (const ord of ordinals) {
		const { txid, vout } = parseOutpoint(ord.outpoint)
		tx.addInput({
			sourceTXID: txid,
			sourceOutputIndex: vout,
			sourceTransaction: await fetchSourceTx(ctx, txid),
			unlockingScriptTemplate: p2pkh.unlock(privateKey),
			sequence: 0xffffffff,
		})
	}

	// Add 1-sat ordinal outputs — positionally matched to inputs
	for (const _ord of ordinals) {
		tx.addOutput({
			lockingScript: p2pkh.lock(destination),
			satoshis: 1,
		})
	}

	// Add funding inputs
	for (const fund of fundingInputs) {
		const { txid, vout } = parseOutpoint(fund.outpoint)
		tx.addInput({
			sourceTXID: txid,
			sourceOutputIndex: vout,
			sourceTransaction: await fetchSourceTx(ctx, txid),
			unlockingScriptTemplate: p2pkh.unlock(privateKey),
			sequence: 0xffffffff,
		})
	}

	// Add change output — fee() will fill in the satoshis
	tx.addOutput({
		lockingScript: p2pkh.lock(sourceAddress),
		change: true,
	})

	// Compute fee and set change amount
	await tx.fee()

	// Sign
	await tx.sign()

	// Broadcast
	const rawTx = tx.toBinary()
	const result = await ctx.services.submitToStack(rawTx)

	return {
		txid: result.txid,
		tx: Array.from(rawTx),
	}
}

/**
 * Transfer ordinals to a destination address with BRC-100 wallet paying fees.
 *
 * Uses createAction so the wallet adds fee inputs and change automatically.
 * The ordinal inputs are signed with the WIF.
 */
async function transferWithWalletFunding(
	ctx: OneSatContext,
	ordinals: SweepInput[],
	privateKey: PrivateKey,
	destination: string,
): Promise<LegacySendResult> {
	if (!ctx.services) return { error: 'services-required' }

	const p2pkh = new P2PKH()

	// Fetch and merge BEEF for all ordinal input transactions
	const txids = [
		...new Set(ordinals.map((o) => parseOutpoint(o.outpoint).txid)),
	]
	const firstBeef = await ctx.services.getBeefForTxid(txids[0])
	for (let i = 1; i < txids.length; i++) {
		firstBeef.mergeBeef(await ctx.services.getBeefForTxid(txids[i]))
	}

	const beefData = firstBeef.toBinary()

	// Build input descriptors for createAction
	const inputDescriptors = ordinals.map((ord) => {
		const { txid, vout } = parseOutpoint(ord.outpoint)
		return {
			outpoint: `${txid}.${vout}`,
			inputDescription: `Ordinal ${ord.outpoint}`,
			unlockingScriptLength: 108,
			sequenceNumber: 0xffffffff,
		}
	})

	// Build 1-sat outputs to destination
	const outputs: Array<{
		lockingScript: string
		satoshis: number
		outputDescription: string
	}> = ordinals.map((ord) => ({
		lockingScript: p2pkh.lock(destination).toHex(),
		satoshis: 1,
		outputDescription: `Transfer ordinal ${ord.outpoint}`,
	}))

	// Create action — wallet adds fee inputs/change
	const createResult = await ctx.wallet.createAction({
		description: `Transfer ${ordinals.length} ordinal${ordinals.length !== 1 ? 's' : ''}`,
		inputBEEF: beefData,
		inputs: inputDescriptors,
		outputs,
		options: { signAndProcess: false, randomizeOutputs: false },
	})

	if ('error' in createResult && createResult.error) {
		return { error: String(createResult.error) }
	}

	if (!createResult.signableTransaction) {
		return { error: 'No signable transaction returned' }
	}

	// Sign the ordinal inputs with WIF
	const tx = Transaction.fromBEEF(createResult.signableTransaction.tx)

	const ourOutpoints = new Set(
		ordinals.map((o) => {
			const { txid, vout } = parseOutpoint(o.outpoint)
			return `${txid}.${vout}`
		}),
	)

	for (let i = 0; i < tx.inputs.length; i++) {
		const txInput = tx.inputs[i]
		const op = `${txInput.sourceTXID}.${txInput.sourceOutputIndex}`
		if (ourOutpoints.has(op)) {
			txInput.unlockingScriptTemplate = p2pkh.unlock(privateKey, 'all', true)
		}
	}

	await tx.sign()

	// Build spends map
	const spends: Record<number, { unlockingScript: string }> = {}
	for (let i = 0; i < tx.inputs.length; i++) {
		const txInput = tx.inputs[i]
		const op = `${txInput.sourceTXID}.${txInput.sourceOutputIndex}`
		if (ourOutpoints.has(op)) {
			spends[i] = {
				unlockingScript: txInput.unlockingScript?.toHex() ?? '',
			}
		}
	}

	// Complete the action
	const signResult = await ctx.wallet.signAction({
		reference: createResult.signableTransaction.reference,
		spends,
		options: { acceptDelayedBroadcast: false },
	})

	if ('error' in signResult) {
		return { error: String(signResult.error) }
	}

	return {
		txid: signResult.txid,
		tx: signResult.tx ? Array.from(signResult.tx) : undefined,
	}
}

/**
 * Transfer ordinals to a raw address.
 *
 * Supports two funding modes:
 * - legacy: funding UTXOs from the same WIF pay for fees
 * - wallet: BRC-100 wallet pays for fees via createAction
 */
export async function legacySendOrdinals(
	ctx: OneSatContext,
	request: LegacySendOrdinalsRequest,
): Promise<LegacySendResult> {
	try {
		const { ordinals, wif, destination, funding } = request

		if (!ordinals.length) return { error: 'no-ordinals' }
		if (!destination) return { error: 'no-destination' }

		const privateKey = PrivateKey.fromWif(wif)

		if (funding.source === 'legacy') {
			if (!funding.inputs.length) return { error: 'no-funding-inputs' }
			return await transferWithLegacyFunding(
				ctx,
				ordinals,
				funding.inputs,
				privateKey,
				destination,
			)
		}

		return await transferWithWalletFunding(
			ctx,
			ordinals,
			privateKey,
			destination,
		)
	} catch (error) {
		console.error('[legacySendOrdinals]', error)
		return { error: error instanceof Error ? error.message : 'unknown-error' }
	}
}

/** Fetch a source transaction from BEEF for use as sourceTransaction on inputs */
export async function fetchSourceTx(
	ctx: OneSatContext,
	txid: string,
): Promise<Transaction> {
	if (!ctx.services) throw new Error('Services required')
	const beef = await ctx.services.getBeefForTxid(txid)
	const found = beef.findTxid(txid)
	if (!found?.tx) throw new Error(`Transaction ${txid} not found in BEEF`)
	return found.tx
}
