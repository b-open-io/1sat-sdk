/**
 * PushDrop token lifecycle mechanics — the reusable core behind
 * OPNS, Gib commit coins, and any other "state lives in a spendable
 * coin" protocol.
 *
 * A PushDrop token is a 1-sat coin whose LOCKING script carries the
 * state: data fields + a recoverable signature locking it to an
 * identity public key. Spending the coin and recreating it with new
 * fields IS the state transition — whoever holds the key owns the
 * lineage. This module provides:
 *
 *   - {@link pushdropLock}   — sealed locking script (mint or move)
 *   - {@link pushdropUnsealedLock} — same, with a zeroed signature
 *     placeholder of exact final size, for two-phase (build-then-seal)
 *     action flows like OPNS apply
 *   - {@link pushdropDecode} — read fields + locking public key back
 *   - {@link pushdropCustomInstructions} — the wallet CI JSON so the
 *     wallet can re-sign this coin in FUTURE actions (required on every
 *     token output you intend to spend later)
 *   - {@link unlockPushDropInputs} — complete a signable transaction by
 *     locally unlocking its PushDrop inputs (the createAction →
 *     signAction dance), given the CI for each input
 *
 * Policy — which fields, which protocolID/keyID, when to seal, which
 * basket/tags — belongs to the protocol built on top (e.g. Gib), not
 * here. This module never bakes in field semantics.
 */

import {
	LockingScript,
	PushDrop,
	type Transaction,
	type WalletInterface,
	type WalletProtocol,
} from '@bsv/sdk'

/** Parameterization of one PushDrop token lineage. */
export interface PushDropTokenSpec {
	/** Token fields, in order, as raw bytes (use `utf8Field`/`hexField`). */
	fields: number[][]
	protocolID: WalletProtocol
	/** BRC-21 keyID; per-state derivation is policy — pass it in. */
	keyID: string
	/** 'self' | 'anyone' | counterparty identity. Tokens are public: 'anyone'. */
	counterparty: string
}

export class PushDropTokenError extends Error {
	constructor(message: string) {
		super(message)
		this.name = 'PushDropTokenError'
	}
}

/** UTF-8 field bytes. */
export function utf8Field(s: string): number[] {
	return Array.from(new TextEncoder().encode(s))
}

/** Raw hex field bytes. */
export function hexField(hex: string): number[] {
	if (!/^([0-9a-fA-F]{2})+$/.test(hex)) {
		throw new PushDropTokenError(`bad hex field: ${hex.slice(0, 20)}…`)
	}
	const out: number[] = []
	for (let i = 0; i < hex.length; i += 2) {
		out.push(parseInt(hex.slice(i, i + 2), 16))
	}
	return out
}

/**
 * Build a fully SEALED PushDrop locking script (real signature
 * included). Use when the signing can happen before the transaction
 * exists — the common token case, since the signature covers only the
 * locking-script data, not the funding inputs.
 */
export async function pushdropLock(
	wallet: WalletInterface,
	spec: PushDropTokenSpec,
): Promise<LockingScript> {
	return await new PushDrop(wallet).lock(
		spec.fields,
		spec.protocolID,
		spec.keyID,
		spec.counterparty,
		true, // forSelf: signature is recoverable, we hold the key
		true, // includeSignature
	)
}

/**
 * Build the locking script with the signature field zeroed to exactly
 * `signaturePlaceholderLen` bytes — the final script is already the
 * on-chain size, so fees computed at build time stay exact. Seal the
 * real signature into the same position later (OPNS apply pattern).
 */
export async function pushdropUnsealedLock(
	wallet: WalletInterface,
	spec: PushDropTokenSpec,
	signaturePlaceholderLen: number,
): Promise<LockingScript> {
	if (
		!Number.isInteger(signaturePlaceholderLen) ||
		signaturePlaceholderLen < 1
	) {
		throw new PushDropTokenError('signaturePlaceholderLen must be >= 1')
	}
	return await new PushDrop(wallet).lock(
		[...spec.fields, new Array(signaturePlaceholderLen).fill(0)],
		spec.protocolID,
		spec.keyID,
		spec.counterparty,
		true,
		false, // no signature: placeholder stands in for it
	)
}

export interface PushDropDecoded {
	/** Token fields (WITHOUT the trailing signature field, if present). */
	fields: number[][]
	/** Identity public key recovered from the lock's signature. */
	lockingPublicKeyHex: string
	/** True when the script carried a recoverable signature. */
	sealed: boolean
}

/** Decode token state from a PushDrop locking script. */
export function pushdropDecode(lockingScript: LockingScript): PushDropDecoded {
	try {
		const { fields, lockingPublicKey } = PushDrop.decode(lockingScript)
		return {
			fields,
			lockingPublicKeyHex: lockingPublicKey.toString(),
			sealed: true,
		}
	} catch (error) {
		throw new PushDropTokenError(
			`not a PushDrop script: ${error instanceof Error ? error.message : 'unknown'}`,
		)
	}
}

/** Field i as UTF-8 text. */
export function pushdropFieldUtf8(
	decoded: PushDropDecoded,
	index: number,
): string {
	const f = decoded.fields[index]
	if (!f) throw new PushDropTokenError(`missing field ${index}`)
	return new TextDecoder().decode(new Uint8Array(f))
}

/**
 * customInstructions JSON to store ON THE TOKEN OUTPUT at creation —
 * without it the wallet cannot sign a later spend of this coin.
 * Include exactly what was used to lock.
 */
export function pushdropCustomInstructions(
	spec: Pick<PushDropTokenSpec, 'protocolID' | 'keyID' | 'counterparty'>,
): string {
	return JSON.stringify({
		protocolID: spec.protocolID,
		keyID: spec.keyID,
		counterparty: spec.counterparty,
	})
}

/** Which PushDrop inputs of a signable tx we can unlock, and how. */
export interface PushDropInputAuthority {
	/** Transaction input index. */
	index: number
	protocolID: WalletProtocol
	keyID: string
	counterparty: string
}

export interface PushDropSpend {
	index: number
	unlockingScriptHex: string
}

/**
 * Locally unlock the designated PushDrop inputs of a signable
 * transaction (the createAction response that came back unsigned),
 * producing the `spends` map entries for wallet.signAction.
 *
 * Each authority names the source output's locking script via
 * `tx.inputs[index].sourceTransaction`, which createAction includes.
 * Missing source data is an error on the caller's action setup, not a
 * silent skip.
 */
export async function unlockPushDropInputs(
	wallet: WalletInterface,
	tx: Transaction,
	authorities: PushDropInputAuthority[],
): Promise<PushDropSpend[]> {
	const spends: PushDropSpend[] = []
	for (const a of authorities) {
		const input = tx.inputs[a.index]
		if (!input) {
			throw new PushDropTokenError(`no input at index ${a.index}`)
		}
		const sourceOutput =
			input.sourceTransaction?.outputs[input.sourceOutputIndex]
		if (!sourceOutput) {
			throw new PushDropTokenError(
				`input ${a.index}: source transaction/output missing — include full source (BEEF) so the PushDrop lock is visible`,
			)
		}
		const pushdrop = new PushDrop(wallet)
		const signer = pushdrop.unlock(
			a.protocolID,
			a.keyID,
			a.counterparty,
			'all',
			false,
			sourceOutput.satoshis,
			sourceOutput.lockingScript,
		)
		const unlockingScript = await signer.sign(tx, a.index)
		spends.push({ index: a.index, unlockingScriptHex: unlockingScript.toHex() })
	}
	return spends
}
