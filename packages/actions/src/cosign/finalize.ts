/**
 * finalizeCosignBsv21Transfer — request 2 of the cosigner-validated transfer flow.
 *
 * Sender returns owner-side signatures over the sighashes given out at prepare
 * time. The cosigner adds its own signature for each cosign-wrapped input,
 * assembles the full unlock <approverSig><ownerSig><ownerPubKey>, calls
 * wallet.signAction to broadcast via its arcade broadcaster, then submits the
 * resulting BEEF to the BSV21 overlay topic.
 *
 * Returns per-recipient delivery payloads — the cosigner backend dispatches
 * these to recipients' MessageBoxes.
 */

import { Cosign } from '@1sat/templates'
import { buildTokenLabel } from '@1sat/types'
import { type SignActionSpend, Utils } from '@bsv/sdk'
import {
	COSIGN_DEFAULT_SIGHASH,
	COSIGN_PROTOCOL_ID,
	type CosignRecipientPayload,
	type FinalizeCosignBsv21TransferInput,
	type FinalizeCosignBsv21TransferResult,
} from './types'

export async function finalizeCosignBsv21Transfer(
	input: FinalizeCosignBsv21TransferInput,
): Promise<FinalizeCosignBsv21TransferResult> {
	const { wallet, services, sessionId, ownerSigs, sessionStore } = input

	// ----------------------------------------------------------------------
	// 1. Load the session.
	// ----------------------------------------------------------------------
	const session = await sessionStore.load(sessionId)
	if (!session) {
		throw new Error(
			`finalizeCosignBsv21Transfer: unknown sessionId ${sessionId}`,
		)
	}

	// ----------------------------------------------------------------------
	// 2. Index ownerSigs by inputIndex; ensure every cosign-wrapped input
	//    has a matching owner sig.
	// ----------------------------------------------------------------------
	const ownerSigByIndex = new Map<number, (typeof ownerSigs)[number]>()
	for (const os of ownerSigs) {
		ownerSigByIndex.set(os.inputIndex, os)
	}
	for (const meta of session.cosignerInputs) {
		if (!ownerSigByIndex.has(meta.inputIndex)) {
			throw new Error(
				`finalizeCosignBsv21Transfer: missing ownerSig for input ${meta.inputIndex}`,
			)
		}
	}

	// ----------------------------------------------------------------------
	// 3. For each cosign-wrapped input: cosigner signs the same sighash that
	//    the owner signed (captured at prepare time), then assembles the
	//    full unlock = <approverSig> <ownerSig> <ownerPubKey>.
	// ----------------------------------------------------------------------
	const spends: Record<number, SignActionSpend> = {}

	for (const meta of session.cosignerInputs) {
		const ownerSig = ownerSigByIndex.get(meta.inputIndex)!
		const ownerSigDER = Utils.toArray(ownerSig.sigHex, 'hex')
		const ownerPubKeyBytes = Utils.toArray(ownerSig.ownerPubkeyHex, 'hex')
		if (ownerPubKeyBytes.length !== 33) {
			throw new Error(
				`finalizeCosignBsv21Transfer: input ${meta.inputIndex} ownerPubkey is not 33-byte compressed`,
			)
		}

		// Cosigner signs the pinned sighash with BRC-29 derivation that
		// matches its own role (counterparty=self, keyID=identity-marker).
		// We use the cosigner's identity key directly (no per-tx derivation
		// for the cosigner side — only the recipient address is BRC-29-derived).
		const sighashBytes = Utils.toArray(meta.sighashHex, 'hex')
		const { signature: cosignerSigDER } = await wallet.createSignature({
			protocolID: COSIGN_PROTOCOL_ID,
			keyID: 'cosigner', // cosigner-side keyID; distinct from per-session destination keyIDs
			counterparty: 'self',
			hashToDirectlySign: sighashBytes,
		})

		// Owner unlock = <ownerSig+hashtype> <ownerPubKey>
		const ownerUnlock = Cosign.ownerUnlock(
			ownerSigDER,
			COSIGN_DEFAULT_SIGHASH,
			ownerSig.ownerPubkeyHex,
		)
		// Full unlock = <cosignerSig+hashtype> <ownerSig+hashtype> <ownerPubKey>
		const fullUnlock = Cosign.approverUnlock(
			Array.from(cosignerSigDER),
			COSIGN_DEFAULT_SIGHASH,
			ownerUnlock,
		)

		spends[meta.inputIndex] = {
			unlockingScript: fullUnlock.toHex(),
		}
	}

	// ----------------------------------------------------------------------
	// 4. Sign the action — the wallet finalizes its funding-input sigs and
	//    broadcasts via its configured arcade broadcaster.
	// ----------------------------------------------------------------------
	const signed = await wallet.signAction({
		reference: session.reference,
		spends,
	})

	if (!signed.txid || !signed.tx) {
		throw new Error(
			'finalizeCosignBsv21Transfer: wallet.signAction did not return txid + tx',
		)
	}

	const beef = Array.isArray(signed.tx) ? signed.tx : Array.from(signed.tx)

	// ----------------------------------------------------------------------
	// 5. Submit BEEF to the BSV21 overlay topic for admission.
	// ----------------------------------------------------------------------
	let overlayStatus = 'BROADCAST'
	try {
		const overlayResult = await services.overlay.submitBsv21(
			beef,
			session.tokenId,
		)
		overlayStatus = overlayResult.status ?? overlayStatus
	} catch (err) {
		// Overlay admission is recoverable — the tx is broadcast either way.
		// Surface the failure but don't poison the response; the caller can
		// retry overlay submission separately if needed.
		console.warn(
			`[finalizeCosignBsv21Transfer] overlay submission failed for ${session.tokenId}:`,
			err,
		)
	}

	// ----------------------------------------------------------------------
	// 6. Internalize multisig destinations (e.g. redemption holding outputs)
	//    into the cosigner's wallet so admin queries can find them via
	//    listOutputs. Each output gets the caller-supplied tags +
	//    customInstructions verbatim.
	// ----------------------------------------------------------------------
	const multisigDests = session.multisigDestinations ?? []
	if (multisigDests.length > 0) {
		try {
			await wallet.internalizeAction({
				tx: beef,
				outputs: multisigDests.map((d) => ({
					outputIndex: d.vout,
					protocol: 'basket insertion',
					insertionRemittance: {
						basket: d.basket ?? 'multisig',
						tags: d.tags ?? [],
						customInstructions: JSON.stringify(d.customInstructions ?? {}),
					},
				})),
				description: `Cosign-multisig outputs (${multisigDests.length})`,
				labels: [buildTokenLabel(session.tokenId)],
			})
		} catch (err) {
			console.warn(
				`[finalizeCosignBsv21Transfer] multisig internalize failed:`,
				err,
			)
		}
	}

	// ----------------------------------------------------------------------
	// 7. Build per-recipient delivery payloads.
	// ----------------------------------------------------------------------
	const recipients: CosignRecipientPayload[] = session.destinations.map(
		(d) => ({
			identityKey: d.recipientIdentityKey,
			vout: d.vout,
			amount: d.amount,
			customInstructions: JSON.stringify({
				protocolID: COSIGN_PROTOCOL_ID,
				keyID: session.sessionId,
				counterparty: session.cosignerIdentityKey,
				cosigner: session.cosignerIdentityKey,
				type: 'cosign-bsv21',
				tokenId: session.tokenId,
			}),
		}),
	)

	// ----------------------------------------------------------------------
	// 8. Cleanup: drop the session record once finalized.
	// ----------------------------------------------------------------------
	await sessionStore.delete(sessionId)

	return {
		txid: signed.txid,
		beef,
		overlayStatus,
		recipients,
	}
}
