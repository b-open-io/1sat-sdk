import {
	ORD_LOCK_V2_ARTIFACT,
	ORD_LOCK_V2_CANCEL_MARKER,
	ORD_LOCK_V2_CODESEP_INDEX,
	ORD_LOCK_V2_PREFIX,
	ORD_LOCK_V2_SLOTS,
	ORD_LOCK_V2_TAG_PREFIX,
	ORD_LOCK_V2_TEMPLATE,
} from '@1sat/types'
import {
	BigNumber,
	Hash,
	LockingScript,
	OP,
	P2PKH,
	type PrivateKey,
	Script,
	type Transaction,
	type TransactionOutput,
	TransactionSignature,
	UnlockingScript,
	Utils,
	type WalletInterface,
	type WalletProtocol,
} from '@bsv/sdk'
import { fillSlots, readSlots } from '../runar/slots.js'

/** OrdLock v2 compiled template as bytes (OP_0 placeholders at the constructor slots). */
export const ORDLOCK_V2_TEMPLATE = Utils.toArray(ORD_LOCK_V2_TEMPLATE, 'hex')

/** OrdLock v2 recognizer prefix as bytes: identical for every v2 listing. */
export const ORDLOCK_V2_PREFIX = Utils.toArray(ORD_LOCK_V2_PREFIX, 'hex')

/** Cancel marker bytes: ASCII "ol2:cancel". */
export const ORDLOCK_V2_CANCEL_MARKER = Utils.toArray(
	ORD_LOCK_V2_CANCEL_MARKER,
	'hex',
)

const TAG_PREFIX = Utils.toArray(ORD_LOCK_V2_TAG_PREFIX, 'hex')

/** Public-method index in the artifact ABI; the unlock's trailing selector push. */
function methodIndex(name: string): number {
	const i = ORD_LOCK_V2_ARTIFACT.abi.methods.findIndex(
		(m) => m.isPublic && m.name === name,
	)
	if (i === -1) throw new Error(`OrdLockV2: ABI has no public method ${name}`)
	return i
}
const PURCHASE_METHOD = methodIndex('purchase')
const CANCEL_METHOD = methodIndex('cancel')
const PURCHASE_SELECTOR =
	PURCHASE_METHOD === 0 ? OP.OP_0 : OP.OP_1 + PURCHASE_METHOD - 1
const CANCEL_SELECTOR =
	CANCEL_METHOD === 0 ? OP.OP_0 : OP.OP_1 + CANCEL_METHOD - 1

/** Sighash flag the purchase preimage is built under (baked into the contract). */
const PURCHASE_SCOPE =
	TransactionSignature.SIGHASH_ALL |
	TransactionSignature.SIGHASH_ANYONECANPAY |
	TransactionSignature.SIGHASH_FORKID

/** Upper bound of a v2 cancel unlock: `<marker> <sig> <pubkey> OP_1` with a 73-byte DER signature. */
export const ORDLOCK_V2_CANCEL_UNLOCK_LENGTH = 1 + 10 + 1 + 73 + 1 + 33 + 1
const CANCEL_UNLOCK_LENGTH = ORDLOCK_V2_CANCEL_UNLOCK_LENGTH

/**
 * OrdLock v2 decoded data structure
 */
export interface OrdLockV2Data {
	/** Seller (cancel) address, base58check */
	seller: string
	/** Listing price in satoshis (the payout output's value) */
	price: bigint
	/** Serialized payout output: 8-byte LE satoshis || varint || script */
	payout: number[]
	/** Byte offset of the v2 script inside the examined locking script */
	offset: number
	/** Byte offset one past the v2 script (trailing data, e.g. MAP, starts here) */
	end: number
}

/** Unlock template shape shared by cancel and purchase. */
export interface OrdLockV2Unlocker {
	sign: (tx: Transaction, inputIndex: number) => Promise<UnlockingScript>
	estimateLength: (tx: Transaction, inputIndex: number) => Promise<number>
}

function indexOf(arr: number[], subArr: number[], fromIndex = 0): number {
	for (let i = fromIndex; i <= arr.length - subArr.length; i++) {
		let found = true
		for (let j = 0; j < subArr.length; j++) {
			if (arr[i + j] !== subArr[j]) {
				found = false
				break
			}
		}
		if (found) return i
	}
	return -1
}

/** Header bytes of an OP_PUSHDATA2 push (the largest either output blob needs). */
const PUSHDATA2_HEADER = 3

function varIntLen(n: number): number {
	return n < 0xfd ? 1 : n <= 0xffff ? 3 : n <= 0xffffffff ? 5 : 9
}

/** Bytes needed to push `n` data bytes (header + data). */
function pushLen(n: number): number {
	return n + (n <= 0x4b ? 1 : n <= 0xff ? 2 : n <= 0xffff ? 3 : 5)
}

function bytesEqual(a: number[], b: number[]): boolean {
	if (a.length !== b.length) return false
	for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
	return true
}

function resolveSource(
	tx: Transaction,
	inputIndex: number,
	sourceSatoshis?: number,
	lockingScript?: Script,
): { sourceTXID: string; sourceSatoshis: number; lockingScript: Script } {
	const input = tx.inputs[inputIndex]
	if (!input) throw new Error(`OrdLockV2: no input at index ${inputIndex}`)
	const sourceTXID = input.sourceTXID ?? input.sourceTransaction?.id('hex')
	if (!sourceTXID) {
		throw new Error(
			'The input sourceTXID or sourceTransaction is required for signing.',
		)
	}
	const src = input.sourceTransaction?.outputs[input.sourceOutputIndex]
	const sats = sourceSatoshis ?? src?.satoshis
	if (sats === undefined) {
		throw new Error(
			'The sourceSatoshis or input sourceTransaction is required for signing.',
		)
	}
	const script = lockingScript ?? src?.lockingScript
	if (!script) {
		throw new Error(
			'The lockingScript or input sourceTransaction is required for signing.',
		)
	}
	return { sourceTXID, sourceSatoshis: sats, lockingScript: script }
}

/**
 * OrdLockV2 - batch-capable ordinal listing (Rúnar `OrdLockV2Batch`).
 *
 * A v2 listing is spent one of two ways:
 *
 * - **purchase**: no signature. The buyer's transaction must contain, somewhere
 *   in its outputs, the listing's payout output IMMEDIATELY followed by a
 *   0-sat tag output `OP_FALSE OP_RETURN <this listing's outpoint>`. Several
 *   listings can be bought in one transaction, each with its own payout+tag
 *   pair. Unlock: `<prefixOutputs> <suffixOutputs> <preimage> OP_0`.
 * - **cancel**: signed by the seller key. Unlock:
 *   `<"ol2:cancel"> <sig> <pubkey> OP_1`.
 *
 * The locking script is built by filling the compiled template's constructor
 * slots; {@link decode} is the exact inverse and needs no contract-specific
 * parsing.
 */
export default class OrdLockV2 {
	/**
	 * Creates an OrdLock v2 locking script for listing an ordinal.
	 *
	 * @param cancelAddress - Address whose key can cancel the listing
	 * @param payAddress - Address that receives payment on purchase
	 * @param price - Listing price in satoshis
	 */
	static lock(
		cancelAddress: string,
		payAddress: string,
		price: number,
	): Script {
		const cancelPkh = Utils.fromBase58Check(cancelAddress).data as number[]
		const payPkh = Utils.fromBase58Check(payAddress).data as number[]
		return OrdLockV2.lockRaw(
			cancelPkh,
			OrdLockV2.buildOutput(price, new P2PKH().lock(payPkh).toBinary()),
		)
	}

	/**
	 * Creates an OrdLock v2 locking script from raw constructor args.
	 *
	 * @param sellerPkh - 20-byte hash160 of the seller (cancel) key
	 * @param payout - Serialized payout output (8-byte LE sats || varint || script)
	 */
	static lockRaw(sellerPkh: number[], payout: number[]): Script {
		if (sellerPkh.length !== 20) {
			throw new Error('OrdLockV2.lock: seller PKH must be 20 bytes')
		}
		if (payout.length < 9) {
			throw new Error('OrdLockV2.lock: payout output too short')
		}
		return Script.fromBinary(
			fillSlots(ORDLOCK_V2_TEMPLATE, ORD_LOCK_V2_SLOTS, [sellerPkh, payout]),
		)
	}

	/**
	 * Decodes an OrdLock v2 listing from a locking script. Trailing data after
	 * the contract (e.g. MAP metadata) is tolerated.
	 *
	 * @returns Decoded listing or null if the script is not a v2 listing
	 */
	static decode(script: Script, mainnet = true): OrdLockV2Data | null {
		try {
			const bin = script.toBinary()
			const offset = indexOf(bin, ORDLOCK_V2_PREFIX)
			if (offset === -1) return null
			const read = readSlots(
				ORDLOCK_V2_TEMPLATE,
				ORD_LOCK_V2_SLOTS,
				bin,
				offset,
			)
			if (!read) return null
			const [sellerPkh, payout] = read.args
			if (!sellerPkh || sellerPkh.length !== 20) return null
			if (!payout || payout.length < 9) return null
			let price = BigInt(0)
			for (let i = 0; i < 8; i++) {
				price |= BigInt(payout[i]) << BigInt(i * 8)
			}
			return {
				seller: Utils.toBase58Check(sellerPkh, mainnet ? [0x00] : [0x6f]),
				price,
				payout,
				offset,
				end: read.end,
			}
		} catch {
			return null
		}
	}

	/**
	 * Checks whether a locking script is (or embeds) an OrdLock v2 listing.
	 */
	static isOrdLockV2(script: Script): boolean {
		return OrdLockV2.decode(script) !== null
	}

	/**
	 * Checks whether an unlocking script is a v2 cancel (marker + OP_1).
	 */
	static isCancel(unlockingScript: Script): boolean {
		const chunks = unlockingScript.chunks
		const first = chunks[0]
		const last = chunks[chunks.length - 1]
		return (
			chunks.length === 4 &&
			first?.data != null &&
			bytesEqual(first.data, ORDLOCK_V2_CANCEL_MARKER) &&
			last?.op === CANCEL_SELECTOR
		)
	}

	/**
	 * Checks whether an unlocking script is a v2 purchase
	 * (`<prefix> <suffix> <preimage> OP_0`).
	 */
	static isPurchase(unlockingScript: Script): boolean {
		const chunks = unlockingScript.chunks
		const preimage = chunks[2]
		const last = chunks[chunks.length - 1]
		return (
			chunks.length === 4 &&
			preimage?.data != null &&
			preimage.data.length >= 156 &&
			last?.op === PURCHASE_SELECTOR
		)
	}

	/**
	 * Builds a serialized transaction output (8-byte LE satoshis || varint || script).
	 */
	static buildOutput(satoshis: number, script: number[]): number[] {
		const writer = new Utils.Writer()
		writer.writeUInt64LEBn(new BigNumber(satoshis))
		writer.writeVarIntNum(script.length)
		writer.write(script)
		return writer.toArray()
	}

	/**
	 * The 36-byte outpoint as the covenant sees it: txid in internal
	 * (little-endian) byte order followed by the 4-byte LE output index.
	 */
	static outpointBytes(txid: string, vout: number): number[] {
		const w = new Utils.Writer()
		w.write(Utils.toArray(txid, 'hex').reverse())
		w.writeUInt32LE(vout)
		return w.toArray()
	}

	/**
	 * Locking script of the tag output a purchase must place immediately after
	 * the listing's payout: `OP_FALSE OP_RETURN <outpoint>`.
	 */
	static tagScript(txid: string, vout: number): LockingScript {
		return new LockingScript()
			.writeOpCode(OP.OP_FALSE)
			.writeOpCode(OP.OP_RETURN)
			.writeBin(OrdLockV2.outpointBytes(txid, vout))
	}

	/**
	 * The 0-sat tag output for a listing outpoint (convenience for tx builders).
	 */
	static tagOutput(txid: string, vout: number): TransactionOutput {
		return { satoshis: 0, lockingScript: OrdLockV2.tagScript(txid, vout) }
	}

	/**
	 * Serialized tag output for a listing outpoint (what the contract expects
	 * to find right after the payout in the output set).
	 */
	static tagOutputBytes(txid: string, vout: number): number[] {
		return [...TAG_PREFIX, ...OrdLockV2.outpointBytes(txid, vout)]
	}

	/**
	 * The payout output the listing demands, from its locking script.
	 */
	static payoutOutput(lockingScript: Script): TransactionOutput {
		const data = OrdLockV2.decode(lockingScript)
		if (!data) throw new Error('OrdLockV2: not a v2 listing')
		const reader = new Utils.Reader(data.payout)
		const satoshis = reader.readUInt64LEBn().toNumber()
		const len = reader.readVarIntNum()
		return {
			satoshis,
			lockingScript: LockingScript.fromBinary(reader.read(len)),
		}
	}

	/**
	 * Upper bound for a v2 purchase unlocking script, for reserving
	 * `unlockingScriptLength` in createAction. The script serializes every
	 * output, and the wallet appends its change outputs after createAction,
	 * so their count is the one thing that cannot be known exactly here.
	 *
	 * `<prefixOutputs> <suffixOutputs> <preimage> <selector>`: the two output
	 * blobs together hold every output except the payout+tag pair exactly
	 * once; the preimage embeds the scriptCode (locking script after the
	 * OP_CODESEPARATOR). Everything is exact except the change allowance.
	 *
	 * @param lockingScript - The listing's locking script (trailing data included)
	 * @param otherOutputsBytes - Serialized size of the caller's outputs other
	 *   than the payout and tag (e.g. the ordinal output and any fee outputs)
	 * @param maxChangeOutputs - Cap on P2PKH change outputs the wallet may add.
	 *   Default matches @bsv/wallet-toolbox `maxChangeOutputsPerTransaction`;
	 *   a wallet configured above it fails at signAction with a clear
	 *   "exceeds expected length" error.
	 */
	static estimatePurchaseUnlockLength(
		lockingScript: Script,
		otherOutputsBytes: number,
		maxChangeOutputs = 8,
	): number {
		const listing = OrdLockV2.decode(lockingScript)
		if (!listing) throw new Error('OrdLockV2: not a v2 listing')
		const scriptCodeLen =
			lockingScript.toBinary().length -
			(listing.offset + ORD_LOCK_V2_CODESEP_INDEX + 1)
		// BIP-143 preimage: 156 fixed bytes + varint(scriptCode) + scriptCode
		const preimageLen = 156 + varIntLen(scriptCodeLen) + scriptCodeLen
		// Serialized P2PKH change output: 8 sats + 1 varint + 25 script
		const outputsLen = otherOutputsBytes + maxChangeOutputs * 34
		return (
			outputsLen +
			PUSHDATA2_HEADER * 2 + // prefix + suffix push headers (worst case)
			pushLen(preimageLen) +
			1 // method selector
		)
	}

	/**
	 * Creates an unlocking script for purchasing a listing.
	 *
	 * The transaction's outputs must contain the listing's payout output
	 * immediately followed by the tag output for this input's outpoint
	 * (see {@link tagOutput}). Where that pair sits is up to the builder, so
	 * multiple listings can be purchased in one transaction. No signature is
	 * required; the contract validates the output set via the preimage.
	 *
	 * @param sourceSatoshis - Input satoshis (optional if sourceTransaction provided)
	 * @param lockingScript - Input locking script (optional if sourceTransaction provided)
	 */
	static purchaseListing(
		sourceSatoshis?: number,
		lockingScript?: Script,
	): OrdLockV2Unlocker {
		const purchase: OrdLockV2Unlocker = {
			sign: async (tx: Transaction, inputIndex: number) => {
				const src = resolveSource(tx, inputIndex, sourceSatoshis, lockingScript)
				const input = tx.inputs[inputIndex]
				const listing = OrdLockV2.decode(src.lockingScript)
				if (!listing) throw new Error('OrdLockV2: input is not a v2 listing')

				const serialized = tx.outputs.map((o) =>
					OrdLockV2.buildOutput(o.satoshis ?? 0, o.lockingScript.toBinary()),
				)
				const tag = OrdLockV2.tagOutputBytes(
					src.sourceTXID,
					input.sourceOutputIndex,
				)
				let pairIndex = -1
				for (let i = 0; i + 1 < serialized.length; i++) {
					if (
						bytesEqual(serialized[i], listing.payout) &&
						bytesEqual(serialized[i + 1], tag)
					) {
						pairIndex = i
						break
					}
				}
				if (pairIndex === -1) {
					throw new Error(
						'OrdLockV2: outputs must contain the listing payout immediately followed by its tag output',
					)
				}
				const prefix = serialized.slice(0, pairIndex).flat()
				const suffix = serialized.slice(pairIndex + 2).flat()

				// scriptCode is everything after the OP_CODESEPARATOR inside the
				// purchase branch (it precedes both constructor slots, so the
				// index is the same in the deployed script).
				const bin = src.lockingScript.toBinary()
				const subscript = Script.fromBinary(
					bin.slice(listing.offset + ORD_LOCK_V2_CODESEP_INDEX + 1),
				)
				const preimage = TransactionSignature.format({
					sourceTXID: src.sourceTXID,
					sourceOutputIndex: input.sourceOutputIndex,
					sourceSatoshis: src.sourceSatoshis,
					transactionVersion: tx.version,
					otherInputs: [],
					inputIndex,
					outputs: tx.outputs,
					inputSequence: input.sequence ?? 0xffffffff,
					subscript,
					lockTime: tx.lockTime,
					scope: PURCHASE_SCOPE,
				})

				const script = new UnlockingScript()
				if (prefix.length) script.writeBin(prefix)
				else script.writeOpCode(OP.OP_0)
				if (suffix.length) script.writeBin(suffix)
				else script.writeOpCode(OP.OP_0)
				return script.writeBin(preimage).writeOpCode(PURCHASE_SELECTOR)
			},
			estimateLength: async (tx: Transaction, inputIndex: number) => {
				return (await purchase.sign(tx, inputIndex)).toBinary().length
			},
		}
		return purchase
	}

	/**
	 * Creates an unlocking script for cancelling a listing with a raw key.
	 * The whole locking script is the scriptCode (the cancel branch executes
	 * no OP_CODESEPARATOR), so the standard P2PKH signer applies.
	 */
	static cancelListing(
		privateKey: PrivateKey,
		signOutputs: 'all' | 'none' | 'single' = 'all',
		anyoneCanPay = false,
		sourceSatoshis?: number,
		lockingScript?: Script,
	): OrdLockV2Unlocker {
		const p2pkh = new P2PKH().unlock(
			privateKey,
			signOutputs,
			anyoneCanPay,
			sourceSatoshis,
			lockingScript,
		)
		return {
			sign: async (tx: Transaction, inputIndex: number) => {
				const sigAndKey = await p2pkh.sign(tx, inputIndex)
				const script = new UnlockingScript().writeBin(ORDLOCK_V2_CANCEL_MARKER)
				for (const chunk of sigAndKey.chunks) script.chunks.push(chunk)
				return script.writeOpCode(CANCEL_SELECTOR)
			},
			estimateLength: async () => CANCEL_UNLOCK_LENGTH,
		}
	}

	/**
	 * Creates an unlocking script for cancelling a listing using a BRC-100
	 * wallet (key derived via protocolID/keyID/counterparty).
	 */
	static cancelWithWallet(
		wallet: WalletInterface,
		protocolID: WalletProtocol,
		keyID: string,
		counterparty = 'self',
	): OrdLockV2Unlocker {
		return {
			sign: async (tx: Transaction, inputIndex: number) => {
				const src = resolveSource(tx, inputIndex)
				const input = tx.inputs[inputIndex]
				const scope = PURCHASE_SCOPE
				const preimage = TransactionSignature.format({
					sourceTXID: src.sourceTXID,
					sourceOutputIndex: input.sourceOutputIndex,
					sourceSatoshis: src.sourceSatoshis,
					transactionVersion: tx.version,
					otherInputs: [],
					inputIndex,
					outputs: tx.outputs,
					inputSequence: input.sequence ?? 0xffffffff,
					subscript: src.lockingScript,
					lockTime: tx.lockTime,
					scope,
				})
				const sighash = Hash.sha256(Hash.sha256(preimage))

				// Full BIP-143 preimage as `data` so the 1Sat permission module can
				// extract hashOutputs + outpoint and auto-grant against the
				// commitment captured at createAction time.
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
				return new UnlockingScript()
					.writeBin(ORDLOCK_V2_CANCEL_MARKER)
					.writeBin([...signature, scope])
					.writeBin(Utils.toArray(publicKey, 'hex'))
					.writeOpCode(CANCEL_SELECTOR)
			},
			estimateLength: async () => CANCEL_UNLOCK_LENGTH,
		}
	}
}
