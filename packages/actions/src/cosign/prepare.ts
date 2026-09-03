/**
 * prepareCosignBsv21Transfer — request 1 of the cosigner-validated transfer flow.
 *
 * The cosigner builds the tx from scratch using destination identity pubkeys
 * (no user-supplied output scripts). This collapses construction risk: the
 * sender can't smuggle a malformed cosign output, and the cosigner is the
 * canonical source for derivation paths.
 */

import { BSV21, Cosign, P2MS } from '@1sat/templates'
import {
	Beef,
	type CreateActionInput,
	type CreateActionOutput,
	Hash,
	LockingScript,
	PublicKey,
	type Transaction,
	TransactionSignature,
	Utils,
} from '@bsv/sdk'
import {
	COSIGN_DEFAULT_SIGHASH,
	COSIGN_PROTOCOL_ID,
	type CosignSessionDestinationMeta,
	type CosignSessionInputMeta,
	type CosignSessionMultisigDestinationMeta,
	type CosignTransferSession,
	type PrepareCosignBsv21TransferInput,
	type PrepareCosignBsv21TransferResult,
} from './types.js'

/** Estimated unlocking script length: <approverSig><ownerSig><ownerPubKey> = ~185 bytes. */
const COSIGN_UNLOCK_SCRIPT_LENGTH = 185

export async function prepareCosignBsv21Transfer(
	input: PrepareCosignBsv21TransferInput,
): Promise<PrepareCosignBsv21TransferResult> {
	const {
		wallet,
		tokenId,
		tokenInputs,
		inputBEEF,
		destinations,
		multisigDestinations,
		burns,
		senderIdentityKey,
		sessionStore,
	} = input

	if (tokenInputs.length === 0) {
		throw new Error(
			'prepareCosignBsv21Transfer: at least one tokenInput required',
		)
	}
	const hasMultisig = !!multisigDestinations && multisigDestinations.length > 0
	if (
		destinations.length === 0 &&
		!hasMultisig &&
		(!burns || burns.length === 0)
	) {
		throw new Error(
			'prepareCosignBsv21Transfer: at least one destination, multisigDestination, or burn required',
		)
	}

	// ----------------------------------------------------------------------
	// Resolve cosigner identity (used as BRC-29 counterparty for derivations,
	// and as the cosigner pubkey embedded in cosign locking scripts).
	// ----------------------------------------------------------------------
	const cosignerIdentity = await wallet.getPublicKey({ identityKey: true })
	const cosignerIdentityKey = cosignerIdentity.publicKey

	// ----------------------------------------------------------------------
	// Allocate a sessionId up front — used as keyID for BRC-29 derivations
	// of every recipient's destination address. This means destinations in
	// the same session share a keyID; recipients across sessions get fresh
	// derivations.
	// ----------------------------------------------------------------------
	const sessionId = generateSessionId()

	// ----------------------------------------------------------------------
	// Decode inputBEEF and locate each token input's source output to extract
	// its locking script (so we can pin sourceLockingScriptHex into the
	// session for sighash computation at finalize time).
	// ----------------------------------------------------------------------
	const beef = Beef.fromBinary(inputBEEF)
	const cosignerInputMetaPartial: Array<{
		inputIndex: number
		sourceTxid: string
		sourceVout: number
		sourceLockingScriptHex: string
		sourceSatoshis: number
	}> = []

	for (let i = 0; i < tokenInputs.length; i++) {
		const { outpoint } = tokenInputs[i]
		const [sourceTxid, voutStr] = outpoint.split('.')
		const sourceVout = Number.parseInt(voutStr, 10)
		if (!sourceTxid || Number.isNaN(sourceVout)) {
			throw new Error(
				`prepareCosignBsv21Transfer: invalid outpoint "${outpoint}" — expected txid.vout`,
			)
		}
		const btx = beef.findTxid(sourceTxid)
		if (!btx?.tx) {
			throw new Error(
				`prepareCosignBsv21Transfer: source tx ${sourceTxid} missing from inputBEEF`,
			)
		}
		const sourceOutput = btx.tx.outputs[sourceVout]
		if (!sourceOutput) {
			throw new Error(
				`prepareCosignBsv21Transfer: source ${outpoint} has no output at vout ${sourceVout}`,
			)
		}
		// Sanity-check: source must be a cosign-wrapped output.
		const cosign = Cosign.decode(sourceOutput.lockingScript)
		if (!cosign) {
			throw new Error(
				`prepareCosignBsv21Transfer: source ${outpoint} is not cosign-wrapped`,
			)
		}
		// And it must match this cosigner.
		if (cosign.cosigner !== cosignerIdentityKey) {
			throw new Error(
				`prepareCosignBsv21Transfer: source ${outpoint} cosigner pubkey ${cosign.cosigner} does not match this cosigner ${cosignerIdentityKey}`,
			)
		}
		cosignerInputMetaPartial.push({
			inputIndex: i, // assumed equal to position in cosigner's createAction inputs
			sourceTxid,
			sourceVout,
			sourceLockingScriptHex: sourceOutput.lockingScript.toHex(),
			sourceSatoshis: sourceOutput.satoshis ?? 1,
		})
	}

	// ----------------------------------------------------------------------
	// Build cosign-wrapped output scripts for each destination by deriving
	// the recipient's destination pubkey via BRC-29.
	// ----------------------------------------------------------------------
	const destinationMetas: CosignSessionDestinationMeta[] = []
	const outputs: CreateActionOutput[] = []

	for (const dest of destinations) {
		const amountBig = BigInt(dest.amount)
		if (amountBig <= 0n) {
			throw new Error(
				`prepareCosignBsv21Transfer: destination amount must be positive`,
			)
		}
		// Derive the recipient's destination pubkey from cosigner's perspective.
		// counterparty = recipient's identityKey (BRC-29 sender→recipient direction).
		const { publicKey: recipientDestPubKey } = await wallet.getPublicKey({
			protocolID: COSIGN_PROTOCOL_ID,
			keyID: sessionId,
			counterparty: dest.recipientIdentityKey,
			forSelf: false,
		})
		const address = PublicKey.fromString(recipientDestPubKey).toAddress()

		const inscription = BSV21.transfer(tokenId, amountBig)
		// BSV21.lock takes the suffix locking script (the Cosign script) and
		// wraps it as the script-suffix of the inscription envelope.
		const cosignSuffix = Cosign.lock(address, cosignerIdentityKey)
		const lockingScript = inscription.lock(cosignSuffix)

		const vout = outputs.length
		destinationMetas.push({
			vout,
			recipientIdentityKey: dest.recipientIdentityKey,
			amount: dest.amount,
			address,
		})
		outputs.push({
			lockingScript: lockingScript.toHex(),
			satoshis: 1,
			outputDescription: `Cosign-wrapped BSV21 transfer to ${dest.recipientIdentityKey.slice(0, 8)}…`,
		})
	}

	// ----------------------------------------------------------------------
	// Multi-sig (P2MS) destinations — typically the redemption holding
	// output. The cosigner does NOT cosign these; spending requires M-of-N
	// admin sigs against the baked pubkeys.
	// ----------------------------------------------------------------------
	const multisigDestinationMetas: CosignSessionMultisigDestinationMeta[] = []
	if (multisigDestinations) {
		for (const dest of multisigDestinations) {
			const amountBig = BigInt(dest.amount)
			if (amountBig <= 0n) {
				throw new Error(
					'prepareCosignBsv21Transfer: multisigDestination amount must be positive',
				)
			}
			if (dest.threshold < 1 || dest.threshold > dest.pubKeys.length) {
				throw new Error(
					`prepareCosignBsv21Transfer: threshold ${dest.threshold} out of range for ${dest.pubKeys.length} pubkeys`,
				)
			}
			const inscription = BSV21.transfer(tokenId, amountBig)
			const p2ms = P2MS.lock(dest.pubKeys, dest.threshold)
			const lockingScript = inscription.lock(p2ms)
			const vout = outputs.length
			multisigDestinationMetas.push({
				vout,
				amount: dest.amount,
				threshold: dest.threshold,
				pubKeys: dest.pubKeys,
				tags: dest.tags,
				customInstructions: dest.customInstructions,
				basket: dest.basket,
			})
			outputs.push({
				lockingScript: lockingScript.toHex(),
				satoshis: 1,
				outputDescription: `BSV21 transfer to ${dest.threshold}-of-${dest.pubKeys.length} multi-sig`,
			})
		}
	}

	// ----------------------------------------------------------------------
	// Burn outputs — plain BSV21 op=burn, no cosign suffix (burn outputs are
	// not meant to be spent further as token-bearing UTXOs).
	// ----------------------------------------------------------------------
	const burnMetas: Array<{ vout: number; amount: string }> = []
	if (burns) {
		for (const burn of burns) {
			const amountBig = BigInt(burn.amount)
			if (amountBig <= 0n) {
				throw new Error(
					'prepareCosignBsv21Transfer: burn amount must be positive',
				)
			}
			const burnInscription = BSV21.burn(tokenId, amountBig)
			// Lock with no suffix — the inscription itself is the entire output.
			const lockingScript = burnInscription.lock()
			const vout = outputs.length
			burnMetas.push({ vout, amount: burn.amount })
			outputs.push({
				lockingScript: lockingScript.toHex(),
				satoshis: 1,
				outputDescription: `BSV21 burn ${burn.amount}`,
			})
		}
	}

	// ----------------------------------------------------------------------
	// Build createAction inputs — external token inputs with
	// unlockingScriptLength only (the unlock comes at signAction time).
	// ----------------------------------------------------------------------
	const createActionInputs: CreateActionInput[] = tokenInputs.map((ti) => ({
		outpoint: ti.outpoint,
		inputDescription: 'Cosign-wrapped BSV21 token input',
		unlockingScriptLength: COSIGN_UNLOCK_SCRIPT_LENGTH,
	}))

	// ----------------------------------------------------------------------
	// Run createAction(signAndProcess: false) on the cosigner's wallet.
	// Wallet auto-funds + adds change, returns signableTransaction.
	// ----------------------------------------------------------------------
	const actionResult = await wallet.createAction({
		description: `Cosign BSV21 transfer (token ${tokenId.slice(0, 8)}…)`,
		inputs: createActionInputs,
		inputBEEF,
		outputs,
		options: {
			signAndProcess: false,
			randomizeOutputs: false,
		},
	})

	const signable = actionResult.signableTransaction
	if (!signable?.tx || !signable.reference) {
		throw new Error(
			'prepareCosignBsv21Transfer: wallet.createAction did not return a signableTransaction',
		)
	}

	// ----------------------------------------------------------------------
	// Decode the signable BEEF to find the actual tx, then compute sighashes
	// for each cosign input over the *final* tx structure (so SIGHASH_ALL
	// is committing to the cosigner's funding inputs + change).
	// ----------------------------------------------------------------------
	const signableBeef = Beef.fromBinary(signable.tx)
	const tipTxids = signableBeef.txs
		.filter((b) => b.tx)
		.map((b) => b.tx!.id('hex'))
	const finalTxid = tipTxids[tipTxids.length - 1]
	const tipBtx = signableBeef.findTxid(finalTxid)
	if (!tipBtx?.tx) {
		throw new Error('prepareCosignBsv21Transfer: signable BEEF has no tip tx')
	}
	const finalTx = tipBtx.tx
	// Wire source transactions back into inputs so sighash format works.
	for (const inp of finalTx.inputs) {
		if (!inp.sourceTransaction && inp.sourceTXID) {
			const src =
				signableBeef.findTxid(inp.sourceTXID) ?? beef.findTxid(inp.sourceTXID)
			if (src?.tx) inp.sourceTransaction = src.tx
		}
	}

	// Match each token input's outpoint to the corresponding input index in
	// the final tx (defensive — wallets may reorder).
	const cosignerInputs: CosignSessionInputMeta[] = []
	const sighashes: PrepareCosignBsv21TransferResult['sighashes'] = []

	for (const meta of cosignerInputMetaPartial) {
		const idx = finalTx.inputs.findIndex(
			(inp) =>
				(inp.sourceTXID ?? inp.sourceTransaction?.id('hex')) ===
					meta.sourceTxid && inp.sourceOutputIndex === meta.sourceVout,
		)
		if (idx < 0) {
			throw new Error(
				`prepareCosignBsv21Transfer: cannot find input ${meta.sourceTxid}.${meta.sourceVout} in built tx`,
			)
		}
		const sighash = computeCosignSighash(finalTx, idx)
		const sighashHex = Utils.toHex(sighash)
		cosignerInputs.push({
			inputIndex: idx,
			sourceTxid: meta.sourceTxid,
			sourceVout: meta.sourceVout,
			sourceLockingScriptHex: meta.sourceLockingScriptHex,
			sourceSatoshis: meta.sourceSatoshis,
			sighashHex,
		})
		sighashes.push({ inputIndex: idx, sighashHex })
	}

	// ----------------------------------------------------------------------
	// Persist the session.
	// ----------------------------------------------------------------------
	const session: CosignTransferSession = {
		sessionId,
		reference: signable.reference,
		signableBeef: Array.from(signable.tx),
		tokenId,
		senderIdentityKey,
		cosignerIdentityKey,
		cosignerInputs,
		destinations: destinationMetas,
		multisigDestinations: multisigDestinationMetas,
		burns: burnMetas,
		createdAt: Date.now(),
	}
	await sessionStore.save(session)

	return {
		sessionId,
		signableBeef: Array.from(signable.tx),
		reference: signable.reference,
		sighashes,
	}
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Compute the single-SHA256 sighash for a cosign-wrapped input, suitable for
 * passing to ECDSA sign. The script interpreter applies the second SHA-256
 * during verification (see @bsv/sdk's P2PKH unlock for the canonical pattern).
 */
function computeCosignSighash(tx: Transaction, inputIndex: number): number[] {
	const inp = tx.inputs[inputIndex]
	const sourceLockingScript =
		inp.sourceTransaction?.outputs[inp.sourceOutputIndex]?.lockingScript
	if (!sourceLockingScript) {
		throw new Error(
			`computeCosignSighash: missing source locking script for input ${inputIndex}`,
		)
	}
	const sourceSatoshis =
		inp.sourceTransaction?.outputs[inp.sourceOutputIndex]?.satoshis ?? 1
	const sourceTXID = inp.sourceTXID ?? inp.sourceTransaction?.id('hex') ?? ''
	const preimage = TransactionSignature.format({
		sourceTXID,
		sourceOutputIndex: inp.sourceOutputIndex,
		sourceSatoshis,
		transactionVersion: tx.version,
		otherInputs: tx.inputs
			.filter((_, i) => i !== inputIndex)
			.map((other) => ({
				sourceTXID:
					other.sourceTXID ?? other.sourceTransaction?.id('hex') ?? '',
				sourceOutputIndex: other.sourceOutputIndex,
				sequence: other.sequence ?? 0xffffffff,
			})),
		inputIndex,
		outputs: tx.outputs,
		inputSequence: inp.sequence ?? 0xffffffff,
		subscript: sourceLockingScript,
		lockTime: tx.lockTime,
		scope: COSIGN_DEFAULT_SIGHASH,
	})
	return Hash.sha256(preimage)
}

/** Generates a random session id (UUIDv4-like, no external dep). */
function generateSessionId(): string {
	const random = new Uint8Array(16)
	crypto.getRandomValues(random)
	random[6] = (random[6] & 0x0f) | 0x40
	random[8] = (random[8] & 0x3f) | 0x80
	const hex = Array.from(random)
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('')
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
}

// Internal export for finalize.ts to reuse.
export { computeCosignSighash, COSIGN_UNLOCK_SCRIPT_LENGTH }

// Suppress unused-import warning for LockingScript when this file is built standalone.
void LockingScript
