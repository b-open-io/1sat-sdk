import {
	Hash,
	LockingScript,
	OP,
	type PrivateKey,
	type Script,
	type Transaction,
	TransactionSignature,
	UnlockingScript,
	Utils,
	type WalletInterface,
	type WalletProtocol,
} from '@bsv/sdk'

/**
 * P2MS decoded data structure
 */
export interface P2MSData {
	/** Compressed pubkeys (33-byte hex) in lock order */
	pubKeys: string[]
	/** Number of signatures required to spend (M) */
	threshold: number
	/** Total number of pubkeys in the lock (N == pubKeys.length) */
	total: number
}

/**
 * Maximum N (and therefore maximum M) supported by this template, set by
 * the single-byte OP_1..OP_16 encoding. Larger sets are valid in BSV
 * consensus but require pushing the count as a script number; a trivial
 * extension if ever needed.
 */
const MAX_PARTIES = 16

/** Returns the opcode byte for a small integer N in 1..16 (OP_1..OP_16). */
function opForN(n: number): number {
	if (n < 1 || n > MAX_PARTIES) {
		throw new Error(`P2MS: integer ${n} out of OP_1..OP_${MAX_PARTIES} range`)
	}
	return OP.OP_1 + (n - 1)
}

/** Inverse of opForN — returns null for non-OP_1..OP_16 opcodes. */
function nForOp(op: number | undefined): number | null {
	if (op === undefined) return null
	if (op >= OP.OP_1 && op <= OP.OP_16) {
		return op - OP.OP_1 + 1
	}
	return null
}

/**
 * Resolves the source output's locking script and satoshi amount for the
 * input being signed, using overrides if provided and otherwise reaching
 * into the input's sourceTransaction.
 */
function resolveSourceContext(
	tx: Transaction,
	inputIndex: number,
	sourceSatoshis: number | undefined,
	lockingScript: Script | undefined,
): { sourceTXID: string; sourceSatoshis: number; lockingScript: Script } {
	const input = tx.inputs[inputIndex]
	const sourceTXID = input.sourceTXID ?? input.sourceTransaction?.id('hex')
	if (!sourceTXID) {
		throw new Error(
			'P2MS: input sourceTXID or sourceTransaction is required for signing',
		)
	}
	const resolvedSatoshis =
		sourceSatoshis ??
		input.sourceTransaction?.outputs[input.sourceOutputIndex].satoshis
	if (resolvedSatoshis === undefined) {
		throw new Error(
			'P2MS: sourceSatoshis or input sourceTransaction is required for signing',
		)
	}
	const resolvedLock =
		lockingScript ??
		input.sourceTransaction?.outputs[input.sourceOutputIndex].lockingScript
	if (!resolvedLock) {
		throw new Error(
			'P2MS: lockingScript or input sourceTransaction is required for signing',
		)
	}
	return {
		sourceTXID,
		sourceSatoshis: resolvedSatoshis,
		lockingScript: resolvedLock,
	}
}

/** Builds the sighash scope byte from the public sighash options. */
function buildSighashScope(
	sighashType: 'all' | 'none' | 'single',
	anyoneCanPay: boolean,
): number {
	let scope = TransactionSignature.SIGHASH_FORKID
	if (sighashType === 'all') scope |= TransactionSignature.SIGHASH_ALL
	if (sighashType === 'none') scope |= TransactionSignature.SIGHASH_NONE
	if (sighashType === 'single') scope |= TransactionSignature.SIGHASH_SINGLE
	if (anyoneCanPay) scope |= TransactionSignature.SIGHASH_ANYONECANPAY
	return scope
}

/** Builds the sighash preimage for a P2MS input. */
function buildPreimage(
	tx: Transaction,
	inputIndex: number,
	scope: number,
	sourceTXID: string,
	sourceSatoshis: number,
	subscript: Script,
): number[] {
	const input = tx.inputs[inputIndex]
	const otherInputs = tx.inputs.filter((_, i) => i !== inputIndex)
	return TransactionSignature.format({
		sourceTXID,
		sourceOutputIndex: input.sourceOutputIndex,
		sourceSatoshis,
		transactionVersion: tx.version,
		otherInputs,
		inputIndex,
		outputs: tx.outputs,
		inputSequence: input.sequence ?? 0xffffffff,
		subscript,
		lockTime: tx.lockTime,
		scope,
	})
}

/**
 * P2MS - Bare M-of-N multisig (OP_CHECKMULTISIG) template.
 *
 * Locking script:
 *   OP_<M> <pubKey1> <pubKey2> ... <pubKeyN> OP_<N> OP_CHECKMULTISIG
 *
 * Unlocking script (top of stack last):
 *   OP_0 <sig1+hashtype> <sig2+hashtype> ... <sigM+hashtype>
 *
 * The leading OP_0 compensates for OP_CHECKMULTISIG's off-by-one (it pops
 * one extra item before processing).
 *
 * Multi-party signing happens externally to this template. Each party
 * produces their own portion via {@link unlockSingle} or
 * {@link unlockSingleWithWallet}. The coordinator collects portions keyed
 * by signing pubkey and assembles the final unlock via {@link unlock}.
 *
 * @example
 * ```typescript
 * // 2-of-3 lock
 * const lock = P2MS.lock([pkA, pkB, pkC], 2)
 *
 * // Each approver produces their own portion (one per party):
 * const portionA = await P2MS.unlockSingle(tx, inputIndex, keyA)
 * const portionC = await P2MS.unlockSingle(tx, inputIndex, keyC)
 *
 * // Coordinator collects portions keyed by signing pubkey:
 * const portions = new Map<string, UnlockingScript>()
 * portions.set(pkA, portionA)
 * portions.set(pkC, portionC)
 *
 * // Assemble — order is derived from the lock script on the input:
 * const unlocker = P2MS.unlock(portions)
 * tx.inputs[inputIndex].unlockingScriptTemplate = unlocker
 * await tx.sign()
 * ```
 */
export default class P2MS {
	/**
	 * Builds a P2MS locking script.
	 *
	 * @param pubKeys - Compressed pubkeys (33-byte hex) in lock order. This
	 *   order matters for unlock — sigs are matched against pubkeys
	 *   left-to-right by OP_CHECKMULTISIG.
	 * @param threshold - M, the number of signatures required to spend.
	 * @throws if `threshold` is out of range, `pubKeys.length` exceeds
	 *   {@link MAX_PARTIES}, or any pubkey is not 33 bytes.
	 */
	static lock(pubKeys: string[], threshold: number): LockingScript {
		if (threshold < 1) {
			throw new Error(`P2MS.lock: threshold must be >= 1 (got ${threshold})`)
		}
		if (pubKeys.length < threshold) {
			throw new Error(
				`P2MS.lock: threshold ${threshold} exceeds pubkey count ${pubKeys.length}`,
			)
		}
		if (pubKeys.length > MAX_PARTIES) {
			throw new Error(
				`P2MS.lock: pubkey count ${pubKeys.length} exceeds maximum ${MAX_PARTIES}`,
			)
		}

		const script = new LockingScript()
		script.writeOpCode(opForN(threshold))

		for (const pubKeyHex of pubKeys) {
			const bytes = Utils.toArray(pubKeyHex, 'hex')
			if (bytes.length !== 33) {
				throw new Error(
					`P2MS.lock: invalid pubkey (expected 33-byte compressed, got ${bytes.length})`,
				)
			}
			script.writeBin(bytes)
		}

		script.writeOpCode(opForN(pubKeys.length))
		script.writeOpCode(OP.OP_CHECKMULTISIG)
		return script
	}

	/**
	 * Decodes a pure P2MS locking script.
	 *
	 * Returns null if the script is not a pure P2MS pattern (no prefix
	 * data, no trailing chunks).
	 */
	static decode(script: Script): P2MSData | null {
		try {
			const chunks = script.chunks
			if (chunks.length < 4) return null

			// Scan all chunks for OP_CHECKMULTISIG and walk backwards from each
			// candidate to extract the P2MS pattern. Handles bare P2MS as well
			// as patterns embedded in larger scripts (e.g. BSV21-prefixed,
			// inscription-suffixed, or with trailing OP_RETURN data).
			for (let i = chunks.length - 1; i >= 3; i--) {
				if (chunks[i].op !== OP.OP_CHECKMULTISIG) continue

				const total = nForOp(chunks[i - 1].op)
				if (total === null) continue

				const thresholdIdx = i - 1 - total - 1
				if (thresholdIdx < 0) continue

				const threshold = nForOp(chunks[thresholdIdx].op)
				if (threshold === null) continue
				if (threshold < 1 || threshold > total) continue

				const pubKeys: string[] = []
				let valid = true
				for (let j = thresholdIdx + 1; j <= thresholdIdx + total; j++) {
					const c = chunks[j]
					if (!c.data || c.data.length !== 33) {
						valid = false
						break
					}
					pubKeys.push(Utils.toHex(c.data as number[]))
				}
				if (!valid) continue

				return { pubKeys, threshold, total }
			}
			return null
		} catch {
			return null
		}
	}

	/** Returns true if the script is a pure P2MS pattern. */
	static isP2MS(script: Script): boolean {
		return P2MS.decode(script) !== null
	}

	/**
	 * Produces this signer's portion of a P2MS unlock using a raw private
	 * key. The returned UnlockingScript contains a single push:
	 * `<sig+hashtype>`.
	 *
	 * The portion gets handed to the coordinator, which keys it by the
	 * signing pubkey and eventually combines it with the other portions
	 * via {@link unlock}.
	 *
	 * @param tx - The unsigned transaction.
	 * @param inputIndex - Index of the P2MS input being signed.
	 * @param privateKey - The signing key. Must correspond to one of the
	 *   pubkeys in the lock.
	 * @param sighashType - SIGHASH_ALL | NONE | SINGLE (default 'all').
	 * @param anyoneCanPay - Whether SIGHASH_ANYONECANPAY is set.
	 * @param sourceSatoshis - Override for the source output amount.
	 * @param lockingScript - Override for the source output's locking script.
	 */
	static async unlockSingle(
		tx: Transaction,
		inputIndex: number,
		privateKey: PrivateKey,
		sighashType: 'all' | 'none' | 'single' = 'all',
		anyoneCanPay = false,
		sourceSatoshis?: number,
		lockingScript?: Script,
	): Promise<UnlockingScript> {
		const scope = buildSighashScope(sighashType, anyoneCanPay)
		const ctx = resolveSourceContext(
			tx,
			inputIndex,
			sourceSatoshis,
			lockingScript,
		)
		const preimage = buildPreimage(
			tx,
			inputIndex,
			scope,
			ctx.sourceTXID,
			ctx.sourceSatoshis,
			ctx.lockingScript,
		)
		const sig = privateKey.sign(Hash.sha256(preimage))
		const sigDER = sig.toDER() as number[]
		return new UnlockingScript().writeBin([...sigDER, scope & 0xff])
	}

	/**
	 * Produces this signer's portion of a P2MS unlock using a BRC-100
	 * wallet. The returned UnlockingScript contains a single push:
	 * `<sig+hashtype>`.
	 *
	 * The wallet's `protocolID` / `keyID` / `counterparty` triple
	 * determines which derived key signs. The same derivation must be used
	 * to register this party's pubkey in the lock script.
	 *
	 * @param tx - The unsigned transaction.
	 * @param inputIndex - Index of the P2MS input being signed.
	 * @param wallet - A BRC-100 WalletInterface.
	 * @param protocolID - Protocol ID for key derivation.
	 * @param keyID - Key ID for key derivation.
	 * @param counterparty - Counterparty for key derivation (default 'self').
	 * @param sighashType - SIGHASH_ALL | NONE | SINGLE (default 'all').
	 * @param anyoneCanPay - Whether SIGHASH_ANYONECANPAY is set.
	 * @param sourceSatoshis - Override for the source output amount.
	 * @param lockingScript - Override for the source output's locking script.
	 */
	static async unlockSingleWithWallet(
		tx: Transaction,
		inputIndex: number,
		wallet: WalletInterface,
		protocolID: WalletProtocol,
		keyID: string,
		counterparty = 'self',
		sighashType: 'all' | 'none' | 'single' = 'all',
		anyoneCanPay = false,
		sourceSatoshis?: number,
		lockingScript?: Script,
	): Promise<UnlockingScript> {
		const scope = buildSighashScope(sighashType, anyoneCanPay)
		const ctx = resolveSourceContext(
			tx,
			inputIndex,
			sourceSatoshis,
			lockingScript,
		)
		const preimage = buildPreimage(
			tx,
			inputIndex,
			scope,
			ctx.sourceTXID,
			ctx.sourceSatoshis,
			ctx.lockingScript,
		)
		const sighash = Hash.sha256(Hash.sha256(preimage))
		// Pass the full BIP-143 preimage as `data` so the 1Sat permission
		// module can extract hashOutputs + outpoint and auto-grant against
		// the commitment captured at createAction time. `hashToDirectlySign`
		// remains the 32-byte input the wallet actually signs.
		const { signature } = await wallet.createSignature({
			protocolID,
			keyID,
			counterparty,
			data: Array.from(preimage),
			hashToDirectlySign: Array.from(sighash),
		})
		return new UnlockingScript().writeBin([
			...Array.from(signature),
			scope & 0xff,
		])
	}

	/**
	 * Coordinator-side: assembles the full unlocking script from collected
	 * portions. Returns the standard ScriptTemplateUnlock shape so it can
	 * be plugged into `tx.inputs[i].unlockingScriptTemplate` and run
	 * through `tx.sign()` like any other template.
	 *
	 * `sign(tx, inputIndex)` reads the locking script from the input's
	 * sourceTransaction, decodes it, walks the pubkeys in order, and picks
	 * the first M portions present in the map. Throws if fewer than M
	 * matching portions are available.
	 *
	 * @param portionsByPubKey - Map keyed by the compressed signing pubkey
	 *   (hex), each value being an UnlockingScript with a single
	 *   `<sig+hashtype>` push as produced by {@link unlockSingle} or
	 *   {@link unlockSingleWithWallet}.
	 */
	static unlock(portionsByPubKey: Map<string, UnlockingScript>): {
		sign: (tx: Transaction, inputIndex: number) => Promise<UnlockingScript>
		estimateLength: (tx: Transaction, inputIndex: number) => Promise<number>
	} {
		return {
			sign: async (tx: Transaction, inputIndex: number) => {
				const ordered = pickPortionsInLockOrder(
					tx,
					inputIndex,
					portionsByPubKey,
				)
				const out = new UnlockingScript().writeOpCode(OP.OP_0)
				for (const portion of ordered) {
					const chunk = portion.chunks[0]
					if (!chunk?.data) {
						throw new Error(
							'P2MS.unlock: portion does not contain a single data push',
						)
					}
					out.writeBin(Array.from(chunk.data))
				}
				return out
			},
			estimateLength: async (tx: Transaction, inputIndex: number) => {
				const ordered = pickPortionsInLockOrder(
					tx,
					inputIndex,
					portionsByPubKey,
				)
				let len = 1 // OP_0
				for (const portion of ordered) {
					len += portion.toBinary().length
				}
				return len
			},
		}
	}
}

/**
 * Resolves the locking script on the input, decodes it as P2MS, and picks
 * the first M portions from `portionsByPubKey` in lock pubkey order.
 * Throws if the lock isn't P2MS or fewer than M portions are available.
 */
function pickPortionsInLockOrder(
	tx: Transaction,
	inputIndex: number,
	portionsByPubKey: Map<string, UnlockingScript>,
): UnlockingScript[] {
	const input = tx.inputs[inputIndex]
	const lock =
		input.sourceTransaction?.outputs[input.sourceOutputIndex].lockingScript
	if (!lock) {
		throw new Error(
			'P2MS.unlock: input sourceTransaction is required to resolve the locking script',
		)
	}
	const decoded = P2MS.decode(lock)
	if (!decoded) {
		throw new Error('P2MS.unlock: input locking script is not a P2MS pattern')
	}
	const ordered: UnlockingScript[] = []
	for (const pk of decoded.pubKeys) {
		const portion = portionsByPubKey.get(pk)
		if (portion) ordered.push(portion)
		if (ordered.length === decoded.threshold) break
	}
	if (ordered.length < decoded.threshold) {
		throw new Error(
			`P2MS.unlock: insufficient portions (have ${ordered.length}, need ${decoded.threshold})`,
		)
	}
	return ordered
}
