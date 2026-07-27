import { OPNS_PUSHDROP_TEMPLATE } from '@1sat/types'
import {
	Hash,
	Signature,
	type Transaction,
	TransactionSignature,
	UnlockingScript,
	type WalletCounterparty,
	type WalletProtocol,
} from '@bsv/sdk'
import type { OneSatContext } from '../types'
import { signP2PKHInput } from './signP2PKH'

/** @deprecated use OPNS_PUSHDROP_TEMPLATE from @1sat/types */
export const PUSHDROP_TEMPLATE = OPNS_PUSHDROP_TEMPLATE

/** PushDrop unlock is a single CHECKSIG push (~73 bytes). */
export const PUSHDROP_UNLOCK_LENGTH = 73

/** P2PKH unlock sig + pubkey (~108 bytes). */
export const P2PKH_UNLOCK_LENGTH = 108

export interface OrdinalCustomInstructions {
	protocolID: WalletProtocol
	keyID: string
	counterparty?: WalletCounterparty
	template?: string
	name?: string
}

export function parseOrdinalCustomInstructions(
	customInstructions: string,
): OrdinalCustomInstructions | { error: string } {
	try {
		return JSON.parse(customInstructions) as OrdinalCustomInstructions
	} catch {
		return { error: 'invalid-custom-instructions' }
	}
}

export function unlockingScriptLengthForInstructions(
	customInstructions: string | undefined,
): number {
	if (!customInstructions) return P2PKH_UNLOCK_LENGTH
	const ci = parseOrdinalCustomInstructions(customInstructions)
	if ('error' in ci) return P2PKH_UNLOCK_LENGTH
	return ci.template === OPNS_PUSHDROP_TEMPLATE
		? PUSHDROP_UNLOCK_LENGTH
		: P2PKH_UNLOCK_LENGTH
}

/**
 * Unlock a PushDrop CHECKSIG input (OpNS published bind).
 *
 * Same permission-module contract as signP2PKHInput: full BIP-143 preimage
 * in `data` so createAction commitment auto-grants; double-SHA in
 * `hashToDirectlySign` for the actual ECDSA (matches stock PushDrop.unlock
 * which passed sha256(preimage) as data and let the wallet hash once more).
 */
async function signPushDropInput(
	ctx: OneSatContext,
	tx: Transaction,
	inputIndex: number,
	protocolID: WalletProtocol,
	keyID: string,
	counterparty: WalletCounterparty,
): Promise<string | { error: string }> {
	const txInput = tx.inputs[inputIndex]
	const sourceLockingScript =
		txInput.sourceTransaction?.outputs[txInput.sourceOutputIndex]?.lockingScript
	if (!sourceLockingScript) {
		return { error: `missing-source-locking-script-for-input-${inputIndex}` }
	}
	const sourceTXID = txInput.sourceTXID ?? txInput.sourceTransaction?.id('hex')
	if (!sourceTXID) {
		return { error: `missing-source-txid-for-input-${inputIndex}` }
	}
	const sourceSatoshis =
		txInput.sourceTransaction?.outputs[txInput.sourceOutputIndex]?.satoshis ?? 1

	const scope =
		TransactionSignature.SIGHASH_ALL | TransactionSignature.SIGHASH_FORKID
	const preimage = TransactionSignature.format({
		sourceTXID,
		sourceOutputIndex: txInput.sourceOutputIndex,
		sourceSatoshis,
		transactionVersion: tx.version,
		otherInputs: tx.inputs
			.filter((_, idx) => idx !== inputIndex)
			.map((inp) => ({
				sourceTXID: inp.sourceTXID ?? inp.sourceTransaction?.id('hex') ?? '',
				sourceOutputIndex: inp.sourceOutputIndex,
				sequence: inp.sequence ?? 0xffffffff,
			})),
		inputIndex,
		outputs: tx.outputs,
		inputSequence: txInput.sequence ?? 0xffffffff,
		subscript: sourceLockingScript,
		lockTime: tx.lockTime,
		scope,
	})
	const sighash = Hash.sha256(Hash.sha256(preimage))

	const { signature: bareSignature } = await ctx.wallet.createSignature({
		protocolID,
		keyID,
		counterparty,
		data: Array.from(preimage),
		hashToDirectlySign: Array.from(sighash),
	})

	const signature = Signature.fromDER([...bareSignature])
	const txSignature = new TransactionSignature(signature.r, signature.s, scope)
	const sigForScript = txSignature.toChecksigFormat()
	return new UnlockingScript([
		{ op: sigForScript.length, data: sigForScript },
	]).toHex()
}

/**
 * Unlock an ordinal input using customInstructions.
 * PushDrop when template === 'pushdrop'; otherwise P2PKH.
 */
export async function signOrdinalInput(
	ctx: OneSatContext,
	tx: Transaction,
	inputIndex: number,
	customInstructions: string,
): Promise<string | { error: string }> {
	const ci = parseOrdinalCustomInstructions(customInstructions)
	if ('error' in ci) return ci
	if (!ci.protocolID || !ci.keyID) {
		return { error: 'missing-protocol-or-key-id' }
	}

	if (ci.template === OPNS_PUSHDROP_TEMPLATE) {
		return signPushDropInput(
			ctx,
			tx,
			inputIndex,
			ci.protocolID,
			ci.keyID,
			ci.counterparty ?? 'anyone',
		)
	}

	return signP2PKHInput(
		ctx,
		tx,
		inputIndex,
		ci.protocolID,
		ci.keyID,
		ci.counterparty ?? 'self',
	)
}
