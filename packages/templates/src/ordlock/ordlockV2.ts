import {
	ORD_LOCK_V2_ARTIFACT,
	ORD_LOCK_V2_CANCEL_MARKER,
	ORD_LOCK_V2_CODESEP_INDEX,
	ORD_LOCK_V2_PREFIX,
	ORD_LOCK_V2_SLOTS,
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

/**
 * Sighash flag the purchase preimage is built under (baked into the
 * contract's `@sighash` directive): SINGLE|ANYONECANPAY|FORKID. SIGHASH_SINGLE
 * commits the listing input at index `i` to the complete output at index `i`,
 * which the covenant requires to equal the seller's embedded payout.
 */
export const ORDLOCK_V2_PURCHASE_SIGHASH =
	TransactionSignature.SIGHASH_SINGLE |
	TransactionSignature.SIGHASH_ANYONECANPAY |
	TransactionSignature.SIGHASH_FORKID

/**
 * Sighash a wallet-signed cancel commits under. ALL binds the seller's chosen
 * outputs; ANYONECANPAY lets the wallet add fee inputs after the signature.
 */
const CANCEL_WALLET_SCOPE =
	TransactionSignature.SIGHASH_ALL |
	TransactionSignature.SIGHASH_ANYONECANPAY |
	TransactionSignature.SIGHASH_FORKID

/** Upper bound of a v2 cancel unlock: `<marker> <sig> <pubkey> OP_1` with a 73-byte DER signature. */
export const ORDLOCK_V2_CANCEL_UNLOCK_LENGTH = 1 + 10 + 1 + 73 + 1 + 33 + 1
const CANCEL_UNLOCK_LENGTH = ORDLOCK_V2_CANCEL_UNLOCK_LENGTH

/** BIP-143 preimage bytes other than the scriptCode and its varint. */
const PREIMAGE_FIXED_LENGTH = 156

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

/**
 * A receive output the buyer approved for a purchased ordinal: the exact
 * output index and locking script the listed satoshi must land on.
 */
export interface OrdLockV2DeliveryTarget {
	vout: number
	lockingScript: Script
}

export interface OrdLockV2PurchaseOptions {
	/**
	 * Buyer-approved receive outputs. When given, the purchase refuses to sign
	 * unless the listed satoshi routes to one of them (same vout and script).
	 * When omitted, the guard still requires a 1-sat, non-data, non-payout
	 * destination, but cannot know which script the buyer intended.
	 */
	deliveries?: OrdLockV2DeliveryTarget[]
}

/** Inputs to {@link OrdLockV2.planPurchase}. */
export interface OrdLockV2PurchasePlanInput {
	/**
	 * Satoshis of each front funding input, in input order. These inputs must
	 * be placed at indices `0 … m-1` of the transaction, before the listings.
	 */
	frontSatoshis: number[]
	/** Locking script of each listing being bought, in input order (indices `m … m+n-1`). */
	listings: Script[]
	/** One 1-satoshi receive output per listing, same order as `listings`. */
	receives: TransactionOutput[]
	/** Script that takes the cushion (front funding minus payouts) when it is non-zero. */
	cushionScript: Script
}

/** Output layout produced by {@link OrdLockV2.planPurchase}. */
export interface OrdLockV2PurchasePlan {
	/** Outputs in transaction order: leading slots, payouts, receives. */
	outputs: TransactionOutput[]
	/** Index of the cushion output, or -1 when the cushion is zero (all leading slots are fillers). */
	cushionVout: number
	/** Indices of the zero-satoshi OP_RETURN fillers among the leading slots. */
	fillerVouts: number[]
	/** Index of each seller payout (equals its listing's input index). */
	payoutVouts: number[]
	/** Index of each buyer receive output, same order as `listings`. */
	receiveVouts: number[]
	/** Total front funding minus total payouts. */
	cushion: number
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

function isDataOutput(script: number[]): boolean {
	return (
		script[0] === OP.OP_RETURN ||
		(script[0] === OP.OP_FALSE && script[1] === OP.OP_RETURN)
	)
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
 * - **purchase**: no signature. The listing at input `i` requires the
 *   complete output `i` of the spending transaction to equal the seller's
 *   payout embedded in the listing (SIGHASH_SINGLE supplies the boundary and
 *   the index). Several listings can be bought in one transaction, each with
 *   its own same-index payout. Unlock: `<preimage> OP_0`.
 * - **cancel**: signed by the seller key. Unlock:
 *   `<"ol2:cancel"> <sig> <pubkey> OP_1`.
 *
 * The covenant binds the seller's payment, not the buyer's delivery. The
 * listed satoshi follows first-sat ordering, so a purchase transaction is
 * laid out as:
 *
 * ```text
 * inputs:  0…m-1 front funding · m…m+n-1 listings · trailing fee funding
 * outputs: 0…m-1 cushion + 0-sat fillers · m…m+n-1 seller payouts · buyer receives · change
 * ```
 *
 * {@link planPurchase} builds that output layout, and {@link purchaseListing}
 * refuses to sign unless the payout sits at the listing's index and the listed
 * satoshi reaches an approved 1-sat receive output.
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
	 * Checks whether an unlocking script is a v2 purchase (`<preimage> OP_0`).
	 */
	static isPurchase(unlockingScript: Script): boolean {
		const chunks = unlockingScript.chunks
		const preimage = chunks[0]
		const last = chunks[1]
		return (
			chunks.length === 2 &&
			preimage?.data != null &&
			preimage.data.length >= PREIMAGE_FIXED_LENGTH &&
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
	 * Lays out the outputs of a batch purchase so that every listing input's
	 * payout sits at the listing's own index and every listed satoshi flows
	 * into its buyer receive output under first-sat ordering.
	 *
	 * Front funding inputs `0 … m-1` must together cover the payouts; each one
	 * reserves a leading output slot. One slot carries the cushion
	 * (`Σfront − Σpayouts`) and the rest are 0-sat `OP_FALSE OP_RETURN`
	 * fillers. Fee funding must be added AFTER the listing inputs and change
	 * AFTER these outputs, or the sat map shifts.
	 */
	static planPurchase(
		input: OrdLockV2PurchasePlanInput,
	): OrdLockV2PurchasePlan {
		const { frontSatoshis, listings, receives, cushionScript } = input
		const m = frontSatoshis.length
		const n = listings.length
		if (m < 1)
			throw new Error(
				'OrdLockV2.planPurchase: at least one front funding input',
			)
		if (n < 1) throw new Error('OrdLockV2.planPurchase: at least one listing')
		if (receives.length !== n) {
			throw new Error('OrdLockV2.planPurchase: one receive output per listing')
		}
		const payouts = listings.map((l) => OrdLockV2.payoutOutput(l))
		const totalPayout = payouts.reduce((s, p) => s + (p.satoshis ?? 0), 0)
		const front = frontSatoshis.reduce((s, v) => s + v, 0)
		if (front < totalPayout) {
			throw new Error(
				`OrdLockV2.planPurchase: front funding ${front} does not cover payouts ${totalPayout}`,
			)
		}
		const cushion = front - totalPayout
		const filler = new LockingScript()
			.writeOpCode(OP.OP_FALSE)
			.writeOpCode(OP.OP_RETURN)

		const outputs: TransactionOutput[] = []
		const fillerVouts: number[] = []
		let cushionVout = -1
		for (let i = 0; i < m; i++) {
			if (i === 0 && cushion > 0) {
				cushionVout = outputs.length
				outputs.push({ satoshis: cushion, lockingScript: cushionScript })
			} else {
				fillerVouts.push(outputs.length)
				outputs.push({ satoshis: 0, lockingScript: filler })
			}
		}
		const payoutVouts: number[] = []
		for (const p of payouts) {
			payoutVouts.push(outputs.length)
			outputs.push(p)
		}
		const receiveVouts: number[] = []
		for (const r of receives) {
			if ((r.satoshis ?? 0) !== 1) {
				throw new Error(
					'OrdLockV2.planPurchase: receive outputs must carry exactly 1 satoshi',
				)
			}
			receiveVouts.push(outputs.length)
			outputs.push(r)
		}
		return {
			outputs,
			cushionVout,
			fillerVouts,
			payoutVouts,
			receiveVouts,
			cushion,
		}
	}

	/**
	 * Output index that receives the first satoshi of `inputIndex` under
	 * first-sat ordering: inputs form one satoshi stream and outputs consume
	 * it in order (0-sat outputs consume nothing). Every earlier input must
	 * carry its source output so its value is known.
	 */
	static ordinalOutput(tx: Transaction, inputIndex: number): number {
		let offset = 0n
		for (let i = 0; i < inputIndex; i++) {
			const inp = tx.inputs[i]
			const sats =
				inp?.sourceTransaction?.outputs[inp.sourceOutputIndex]?.satoshis
			if (sats === undefined) {
				throw new Error(
					`OrdLockV2: input ${i} has no source satoshis; cannot map the ordinal from input ${inputIndex}`,
				)
			}
			offset += BigInt(sats)
		}
		let acc = 0n
		for (let vout = 0; vout < tx.outputs.length; vout++) {
			const next = acc + BigInt(tx.outputs[vout].satoshis ?? 0)
			if (offset < next) return vout
			acc = next
		}
		throw new Error(
			`OrdLockV2: the ordinal from input ${inputIndex} is not mapped to any output (it would be burned as fee)`,
		)
	}

	/**
	 * Delivery guard. Throws unless the listed satoshi spent by `inputIndex`
	 * lands on an output that carries exactly 1 satoshi and, when
	 * `deliveries` is given, matches one of them by index and script. Without
	 * `deliveries` the destination must at least not be a data output or a
	 * seller payout slot of any v2 listing in the transaction.
	 *
	 * @returns the output index the ordinal is delivered to
	 */
	static assertDelivery(
		tx: Transaction,
		inputIndex: number,
		deliveries?: OrdLockV2DeliveryTarget[],
	): number {
		const vout = OrdLockV2.ordinalOutput(tx, inputIndex)
		const out = tx.outputs[vout]
		if ((out.satoshis ?? 0) !== 1) {
			throw new Error(
				`OrdLockV2: listing input ${inputIndex} delivers its ordinal to output ${vout} carrying ${out.satoshis} sats, not a 1-sat receive output`,
			)
		}
		const script = out.lockingScript.toBinary()
		if (deliveries) {
			const ok = deliveries.some(
				(d) =>
					d.vout === vout && bytesEqual(d.lockingScript.toBinary(), script),
			)
			if (!ok) {
				throw new Error(
					`OrdLockV2: listing input ${inputIndex} delivers its ordinal to output ${vout}, which is not an approved receive output`,
				)
			}
			return vout
		}
		if (isDataOutput(script)) {
			throw new Error(
				`OrdLockV2: listing input ${inputIndex} delivers its ordinal to data output ${vout}`,
			)
		}
		for (let i = 0; i < tx.inputs.length; i++) {
			const inp = tx.inputs[i]
			const src = inp.sourceTransaction?.outputs[inp.sourceOutputIndex]
			if (i === vout && src && OrdLockV2.isOrdLockV2(src.lockingScript)) {
				throw new Error(
					`OrdLockV2: listing input ${inputIndex} delivers its ordinal to output ${vout}, the payout slot of listing input ${i}`,
				)
			}
		}
		return vout
	}

	/**
	 * Exact length of a v2 purchase unlocking script for a listing, for
	 * reserving `unlockingScriptLength` in createAction. The unlock is only
	 * `<preimage> OP_0`, and the preimage size depends solely on the listing's
	 * scriptCode, so the wallet's later fee inputs and change outputs cannot
	 * change it.
	 *
	 * @param lockingScript - The listing's locking script (trailing data included)
	 */
	static estimatePurchaseUnlockLength(lockingScript: Script): number {
		const listing = OrdLockV2.decode(lockingScript)
		if (!listing) throw new Error('OrdLockV2: not a v2 listing')
		const scriptCodeLen =
			lockingScript.toBinary().length -
			(listing.offset + ORD_LOCK_V2_CODESEP_INDEX + 1)
		const preimageLen =
			PREIMAGE_FIXED_LENGTH + varIntLen(scriptCodeLen) + scriptCodeLen
		return pushLen(preimageLen) + 1
	}

	/**
	 * Creates an unlocking script for purchasing a listing.
	 *
	 * The transaction's output at the listing's input index must be the
	 * listing's payout output, and the listed satoshi must route (first-sat
	 * ordering) to a 1-sat receive output; see {@link planPurchase} for the
	 * layout and {@link assertDelivery} for the guard. No signature is
	 * required; the contract validates the payout via the preimage.
	 *
	 * @param sourceSatoshis - Input satoshis (optional if sourceTransaction provided)
	 * @param lockingScript - Input locking script (optional if sourceTransaction provided)
	 * @param options - Buyer-approved receive outputs for the delivery guard
	 */
	static purchaseListing(
		sourceSatoshis?: number,
		lockingScript?: Script,
		options: OrdLockV2PurchaseOptions = {},
	): OrdLockV2Unlocker {
		const purchase: OrdLockV2Unlocker = {
			sign: async (tx: Transaction, inputIndex: number) => {
				const src = resolveSource(tx, inputIndex, sourceSatoshis, lockingScript)
				const input = tx.inputs[inputIndex]
				const listing = OrdLockV2.decode(src.lockingScript)
				if (!listing) throw new Error('OrdLockV2: input is not a v2 listing')

				const bound = tx.outputs[inputIndex]
				if (!bound) {
					throw new Error(
						`OrdLockV2: no output at index ${inputIndex}; SIGHASH_SINGLE binds listing input ${inputIndex} to output ${inputIndex}`,
					)
				}
				const serialized = OrdLockV2.buildOutput(
					bound.satoshis ?? 0,
					bound.lockingScript.toBinary(),
				)
				if (!bytesEqual(serialized, listing.payout)) {
					throw new Error(
						`OrdLockV2: output ${inputIndex} must be the listing payout (${listing.price} sats to the seller's payout script)`,
					)
				}
				OrdLockV2.assertDelivery(tx, inputIndex, options.deliveries)

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
					scope: ORDLOCK_V2_PURCHASE_SIGHASH,
				})

				return new UnlockingScript()
					.writeBin(preimage)
					.writeOpCode(PURCHASE_SELECTOR)
			},
			estimateLength: async (tx: Transaction, inputIndex: number) => {
				const src = resolveSource(tx, inputIndex, sourceSatoshis, lockingScript)
				return OrdLockV2.estimatePurchaseUnlockLength(src.lockingScript)
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
				const scope = CANCEL_WALLET_SCOPE
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
