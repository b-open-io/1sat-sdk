import { Lock, OrdLock } from '@1sat/templates'
import {
	BigNumber,
	Hash,
	type LockingScript,
	OP,
	PushDrop,
	Signature,
	type Transaction,
	TransactionSignature,
	UnlockingScript,
	Utils,
	type WalletCounterparty,
	type WalletInterface,
	type WalletProtocol,
} from '@bsv/sdk'
import { loadBasketOutput } from '../utils/loadBasketOutput'
import { ensurePlaintextCi } from '../utils/walletMetadataCi'
import type { ResolvedSpend, Spend } from './spendTargets'
import { mergeResolvedSpends } from './spendTargets'

export type UnlockResult =
	| { unlockingScript: string }
	| { error: string; skip?: boolean }

interface KeyCi {
	protocolID: WalletProtocol
	keyID: string
	counterparty?: WalletCounterparty
}

/**
 * Turn spends into finish records (outpoint + CI).
 * - Already has outpoint+CI → use as-is (local load).
 * - basket+id without usable CI → load from wallet storage.
 * - outpoint only → buy/external (no CI).
 */
export async function materializeSpends(
	wallet: WalletInterface,
	spends: Spend[],
): Promise<ResolvedSpend[] | { error: string }> {
	const out: ResolvedSpend[] = []

	for (const s of spends) {
		if (s.outpoint && s.customInstructions) {
			// Caller-supplied CI may still be WPM ciphertext (base wallet).
			const ci =
				(await ensurePlaintextCi(wallet, s.customInstructions)) ??
				s.customInstructions
			out.push({
				outpoint: s.outpoint.replace('_', '.'),
				customInstructions: ci,
			})
			continue
		}

		if (s.basket && s.id) {
			// loadBasketOutput always returns plaintext CI.
			const loaded = await loadBasketOutput(wallet, s.basket, s.id)
			if ('error' in loaded) return { error: loaded.error }
			if (!loaded.output.customInstructions) {
				return {
					error: `missing-ci-after-load:${s.basket}:${s.id}`,
				}
			}
			out.push({
				outpoint: loaded.output.outpoint.replace('_', '.'),
				customInstructions: loaded.output.customInstructions,
			})
			continue
		}

		if (s.outpoint) {
			out.push({ outpoint: s.outpoint.replace('_', '.') })
			continue
		}

		return { error: 'spend-missing-outpoint-or-basket-id' }
	}

	return mergeResolvedSpends(out)
}

/** @deprecated use materializeSpends */
export const resolveSpendTargets = materializeSpends

/**
 * Build unlocking scripts from resolved spends + signable tx.
 * Script/sats from tx inputs (BEEF); CI from the record when present.
 */
export async function buildSpendsForResolved(
	wallet: WalletInterface,
	tx: Transaction,
	resolved: ResolvedSpend[],
): Promise<Record<number, { unlockingScript: string }> | { error: string }> {
	const spends: Record<number, { unlockingScript: string }> = {}

	const inputByOutpoint = new Map<string, number>()
	for (let i = 0; i < tx.inputs.length; i++) {
		const inp = tx.inputs[i]!
		const txid = inp.sourceTXID ?? inp.sourceTransaction?.id('hex')
		if (!txid) continue
		inputByOutpoint.set(`${txid}.${inp.sourceOutputIndex}`, i)
	}

	for (const r of resolved) {
		const norm = r.outpoint.replace('_', '.')
		let inputIndex = inputByOutpoint.get(norm) ?? inputByOutpoint.get(r.outpoint)
		if (inputIndex === undefined) {
			for (const [k, v] of inputByOutpoint) {
				if (k.replace('_', '.') === norm) {
					inputIndex = v
					break
				}
			}
		}
		if (inputIndex === undefined) {
			return { error: `spend-not-in-tx:${r.outpoint}` }
		}
		const inp = tx.inputs[inputIndex]!
		const lockingScript =
			inp.sourceTransaction?.outputs[inp.sourceOutputIndex]?.lockingScript
		const sourceSatoshis =
			inp.sourceTransaction?.outputs[inp.sourceOutputIndex]?.satoshis ?? 1
		if (!lockingScript) {
			return { error: `missing-locking-script:input-${inputIndex}` }
		}
		const keyCi = parseKeyCi(r.customInstructions)
		const unlocked = await unlockByScript(
			wallet,
			tx,
			inputIndex,
			lockingScript,
			sourceSatoshis,
			keyCi,
		)
		if ('error' in unlocked) {
			if (unlocked.skip) continue
			return { error: unlocked.error }
		}
		spends[inputIndex] = { unlockingScript: unlocked.unlockingScript }
	}

	return spends
}

/** @deprecated prefer materializeSpends + buildSpendsForResolved */
export async function buildSpendsForTargets(
	wallet: WalletInterface,
	tx: Transaction,
	targets: Spend[],
): Promise<Record<number, { unlockingScript: string }> | { error: string }> {
	const resolved = await materializeSpends(wallet, targets)
	if ('error' in resolved) return resolved
	return buildSpendsForResolved(wallet, tx, resolved)
}

/**
 * Unlock one input from locking-script shape.
 * - OrdLock + CI → cancel; OrdLock without → purchase unlock
 * - PushDrop / Lock / P2PKH → need CI
 */
export async function unlockByScript(
	wallet: WalletInterface,
	tx: Transaction,
	inputIndex: number,
	lockingScript: LockingScript,
	sourceSatoshis: number,
	keyCi?: KeyCi,
): Promise<UnlockResult> {
	if (OrdLock.decode(lockingScript)) {
		if (keyCi?.protocolID && keyCi.keyID) {
			try {
				const unlocker = OrdLock.cancelWithWallet(
					wallet,
					keyCi.protocolID,
					keyCi.keyID,
					keyCi.counterparty ?? 'self',
				)
				const unlockingScript = await unlocker.sign(tx, inputIndex)
				return { unlockingScript: unlockingScript.toHex() }
			} catch (e) {
				return {
					error: e instanceof Error ? e.message : 'ordlock-cancel-failed',
				}
			}
		}
		try {
			const script = buildPurchaseUnlockingScript(
				tx,
				inputIndex,
				sourceSatoshis,
				lockingScript,
			)
			return { unlockingScript: script.toHex() }
		} catch (e) {
			return {
				error: e instanceof Error ? e.message : 'ordlock-purchase-unlock-failed',
			}
		}
	}

	if (!keyCi?.protocolID || !keyCi.keyID) {
		return { error: `missing-key-ci-for-input-${inputIndex}` }
	}

	if (Lock.decode(lockingScript)) {
		try {
			const unlocker = Lock.unlockWithWallet(
				wallet,
				keyCi.protocolID,
				keyCi.keyID,
				keyCi.counterparty ?? 'self',
			)
			const unlockingScript = await unlocker.sign(tx, inputIndex)
			return { unlockingScript: unlockingScript.toHex() }
		} catch (e) {
			return {
				error: e instanceof Error ? e.message : 'lock-unlock-failed',
			}
		}
	}

	try {
		PushDrop.decode(lockingScript)
		return signPushDropInput(
			wallet,
			tx,
			inputIndex,
			keyCi.protocolID,
			keyCi.keyID,
			keyCi.counterparty ?? 'anyone',
		)
	} catch {
		// not pushdrop
	}

	return signP2PKHInputWallet(
		wallet,
		tx,
		inputIndex,
		keyCi.protocolID,
		keyCi.keyID,
		keyCi.counterparty ?? 'self',
	)
}

function parseKeyCi(raw: string | undefined): KeyCi | undefined {
	if (!raw) return undefined
	try {
		const o = JSON.parse(raw) as KeyCi
		if (!o.protocolID || !o.keyID) return undefined
		return o
	} catch {
		return undefined
	}
}

function buildSerializedOutput(satoshis: number, script: number[]): number[] {
	const writer = new Utils.Writer()
	writer.writeUInt64LEBn(new BigNumber(satoshis))
	writer.writeVarIntNum(script.length)
	writer.write(script)
	return writer.toArray()
}

/** OrdLock purchase unlock. */
export function buildPurchaseUnlockingScript(
	tx: Transaction,
	inputIndex: number,
	sourceSatoshis: number,
	lockingScript: LockingScript,
): UnlockingScript {
	if (tx.outputs.length < 2) {
		throw new Error('Malformed transaction: requires at least 2 outputs')
	}

	const script = new UnlockingScript().writeBin(
		buildSerializedOutput(
			tx.outputs[0]!.satoshis ?? 0,
			tx.outputs[0]!.lockingScript.toBinary(),
		),
	)

	if (tx.outputs.length > 2) {
		const writer = new Utils.Writer()
		for (const output of tx.outputs.slice(2)) {
			writer.write(
				buildSerializedOutput(
					output.satoshis ?? 0,
					output.lockingScript.toBinary(),
				),
			)
		}
		script.writeBin(writer.toArray())
	} else {
		script.writeOpCode(OP.OP_0)
	}

	const input = tx.inputs[inputIndex]!
	const sourceTXID = input.sourceTXID ?? input.sourceTransaction?.id('hex')
	if (!sourceTXID) throw new Error('sourceTXID is required')

	const preimage = TransactionSignature.format({
		sourceTXID,
		sourceOutputIndex: input.sourceOutputIndex,
		sourceSatoshis,
		transactionVersion: tx.version,
		otherInputs: [],
		inputIndex,
		outputs: tx.outputs,
		inputSequence: input.sequence ?? 0xffffffff,
		subscript: lockingScript,
		lockTime: tx.lockTime,
		scope:
			TransactionSignature.SIGHASH_ALL |
			TransactionSignature.SIGHASH_ANYONECANPAY |
			TransactionSignature.SIGHASH_FORKID,
	})

	return script.writeBin(preimage).writeOpCode(OP.OP_0)
}

async function signPushDropInput(
	wallet: WalletInterface,
	tx: Transaction,
	inputIndex: number,
	protocolID: WalletProtocol,
	keyID: string,
	counterparty: WalletCounterparty,
): Promise<UnlockResult> {
	const txInput = tx.inputs[inputIndex]!
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

	const { signature: bareSignature } = await wallet.createSignature({
		protocolID,
		keyID,
		counterparty,
		data: Array.from(preimage),
		hashToDirectlySign: Array.from(sighash),
	})

	const signature = Signature.fromDER([...bareSignature])
	const txSignature = new TransactionSignature(signature.r, signature.s, scope)
	const sigForScript = txSignature.toChecksigFormat()
	return {
		unlockingScript: new UnlockingScript([
			{ op: sigForScript.length, data: sigForScript },
		]).toHex(),
	}
}

async function signP2PKHInputWallet(
	wallet: WalletInterface,
	tx: Transaction,
	inputIndex: number,
	protocolID: WalletProtocol,
	keyID: string,
	counterparty: WalletCounterparty,
): Promise<UnlockResult> {
	const txInput = tx.inputs[inputIndex]!
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
		scope:
			TransactionSignature.SIGHASH_ALL | TransactionSignature.SIGHASH_FORKID,
	})
	const sighash = Hash.sha256(Hash.sha256(preimage))
	const { signature } = await wallet.createSignature({
		protocolID,
		keyID,
		counterparty,
		data: Array.from(preimage),
		hashToDirectlySign: Array.from(sighash),
	})
	const { publicKey } = await wallet.getPublicKey({
		protocolID,
		keyID,
		counterparty,
		forSelf: true,
	})
	const sigWithHashtype = [
		...signature,
		TransactionSignature.SIGHASH_ALL | TransactionSignature.SIGHASH_FORKID,
	]
	return {
		unlockingScript: new UnlockingScript()
			.writeBin(sigWithHashtype)
			.writeBin(Utils.toArray(publicKey, 'hex'))
			.toHex(),
	}
}
