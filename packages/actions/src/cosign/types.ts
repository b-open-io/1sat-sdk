/**
 * Cosigner-validated BSV21 transfer types and session store contract.
 *
 * The flow is split into two requests on the cosigner backend:
 *   1. prepareCosignBsv21Transfer — cosigner constructs the tx (cosign-wrapped
 *      transfer outputs + optional burn outputs), allocates sat-funding via
 *      its own BRC-100 wallet (createAction with signAndProcess: false),
 *      persists the session, and returns the signable BEEF + per-input
 *      sighashes for the sender to sign.
 *   2. finalizeCosignBsv21Transfer — sender returns owner-side sigs, cosigner
 *      adds its own sig per cosign-wrapped input, calls signAction to broadcast
 *      via the wallet, then submits the resulting BEEF to the BSV21 overlay
 *      topic. Returns per-recipient customInstructions blobs the caller can
 *      drop into messagebox payloads.
 */

import type { WalletProtocol } from '@bsv/sdk'
import { P1SAT_PROTOCOL } from '@1sat/types'

/**
 * Protocol used to derive cosign-locked destination keys. Unified under
 * 'p 1sat' so the permission module gates signing requests for cosign
 * UTXOs the same way as ordinals/BSV21/etc.
 *
 * Both cosigner (as constructor) and recipient (when later spending) derive
 * with this protocol, with the cosigner's identityKey as counterparty.
 */
export const COSIGN_PROTOCOL_ID: WalletProtocol = P1SAT_PROTOCOL

/** Default sighash byte for the cosigner's signature on cosign-wrapped inputs. */
export const COSIGN_DEFAULT_SIGHASH = 0x41 // SIGHASH_ALL | SIGHASH_FORKID

/** A token UTXO being spent in a transfer. */
export interface CosignTokenInput {
	/** Outpoint in `txid.vout` form. */
	outpoint: string
}

/** A transfer destination — the cosigner derives the recipient address internally. */
export interface CosignTransferDestination {
	/** Recipient's BRC-100 identity public key (compressed, hex). */
	recipientIdentityKey: string
	/** Token amount to send (bigint serialized as string for JSON safety). */
	amount: string
}

/** A burn intent — destroys tokens via a BSV21 op=burn output. */
export interface CosignTransferBurn {
	/** Token amount to burn (bigint serialized as string). */
	amount: string
}

/**
 * A multi-sig (P2MS) destination — typically used for redemption holding
 * outputs locked to the admin set. The cosigner does NOT cosign these
 * outputs; spending them later requires M-of-N admin signatures.
 *
 * The cosigner also doesn't itself derive the pubkeys — the caller passes
 * the already-derived signing pubkeys (admins typically derive via
 * counterparty='anyone' + a known protocol/keyID).
 */
export interface CosignTransferMultisigDestination {
	/** Token amount routed to this output (bigint serialized as string). */
	amount: string
	/** M — signatures required. */
	threshold: number
	/** Compressed signing pubkeys (33-byte hex), in lock order. */
	pubKeys: string[]
	/**
	 * Free-form metadata recorded on the resulting output's wallet record
	 * (cosigner-side internalize tags + customInstructions). Lets callers
	 * stamp redemption-specific data onto the holding UTXO.
	 */
	tags?: string[]
	customInstructions?: Record<string, unknown>
	basket?: string
}

// ============================================================================
// Persistent session shape
// ============================================================================

/** Per-cosign-wrapped-input metadata captured at prepare time and reused at finalize. */
export interface CosignSessionInputMeta {
	inputIndex: number
	sourceTxid: string
	sourceVout: number
	/** Hex of the source output's locking script (the cosign script). */
	sourceLockingScriptHex: string
	sourceSatoshis: number
	/** Hex of the SHA-256 (single, pre-double) sighash that the owner is asked to sign. */
	sighashHex: string
}

/** Per-destination metadata captured at prepare time. */
export interface CosignSessionDestinationMeta {
	vout: number
	recipientIdentityKey: string
	amount: string
	/** Owner address used in the cosign locking script. */
	address: string
}

/** Per-multisig-destination metadata captured at prepare time. */
export interface CosignSessionMultisigDestinationMeta {
	vout: number
	amount: string
	threshold: number
	pubKeys: string[]
	tags?: string[]
	customInstructions?: Record<string, unknown>
	basket?: string
}

/** Session record persisted between /transfer/prepare and /transfer/finalize. */
export interface CosignTransferSession {
	sessionId: string
	/** Reference returned by wallet.createAction — needed for signAction. */
	reference: string
	/** Atomic BEEF of the unsigned tx (with funding inputs + change in place). */
	signableBeef: number[]
	tokenId: string
	senderIdentityKey: string
	/** Cosigner identityKey at the time of prepare (in case the wallet's identity changes). */
	cosignerIdentityKey: string
	cosignerInputs: CosignSessionInputMeta[]
	destinations: CosignSessionDestinationMeta[]
	multisigDestinations: CosignSessionMultisigDestinationMeta[]
	burns: Array<{ vout: number; amount: string }>
	createdAt: number
}

// ============================================================================
// Session store contract
// ============================================================================

/**
 * Pluggable session storage. The cosigner backend supplies an
 * implementation backed by its persistence layer (e.g. Postgres). The
 * in-memory implementation is suitable for tests + ephemeral demo usage.
 */
export interface CosignSessionStore {
	save(session: CosignTransferSession): Promise<void>
	load(sessionId: string): Promise<CosignTransferSession | null>
	delete(sessionId: string): Promise<void>
}

/** Default in-memory store. Not suitable for multi-process or persistence-across-restart. */
export class InMemoryCosignSessionStore implements CosignSessionStore {
	private store = new Map<string, CosignTransferSession>()

	async save(session: CosignTransferSession): Promise<void> {
		this.store.set(session.sessionId, session)
	}

	async load(sessionId: string): Promise<CosignTransferSession | null> {
		return this.store.get(sessionId) ?? null
	}

	async delete(sessionId: string): Promise<void> {
		this.store.delete(sessionId)
	}
}

// ============================================================================
// Prepare action
// ============================================================================

import type { OneSatServices } from '@1sat/client'
import type { WalletInterface } from '@bsv/sdk'

export interface PrepareCosignBsv21TransferInput {
	/** The cosigner's BRC-100 wallet (e.g. @1sat/wallet-remote pointed at wallet.1sat.app). */
	wallet: WalletInterface
	/** OneSatServices client for overlay operations. */
	services: OneSatServices
	/** BSV21 token id this transfer is for. */
	tokenId: string
	/** Cosign-wrapped UTXOs being spent. */
	tokenInputs: CosignTokenInput[]
	/**
	 * Atomic BEEF carrying every input's source tx + dependency chain, in the
	 * shape produced by Beef.toBinaryAtomic on the user's wallet.
	 */
	inputBEEF: number[]
	/** Transfer destinations. May be empty if the request is burn-only or holding-only. */
	destinations: CosignTransferDestination[]
	/** Optional multi-sig (P2MS) destinations — used for redemption holding outputs. */
	multisigDestinations?: CosignTransferMultisigDestination[]
	/** Optional burn outputs. */
	burns?: CosignTransferBurn[]
	/** Sender's identityKey, supplied by the auth middleware. */
	senderIdentityKey: string
	/** Session store (cosigner backend supplies impl). */
	sessionStore: CosignSessionStore
}

export interface PrepareCosignBsv21TransferResult {
	sessionId: string
	/** Atomic BEEF of the unsigned tx (with cosigner's funding inputs + change in place). */
	signableBeef: number[]
	/** wallet.createAction reference — opaque to the user. Backend reuses at finalize time. */
	reference: string
	/**
	 * Sighashes the sender's wallet must sign with the owner key for each
	 * cosign-wrapped input. SIGHASH = SIGHASH_ALL | SIGHASH_FORKID (0x41).
	 * The wallet should sign single-SHA256 of these (the script interpreter
	 * applies the second SHA-256 internally during verification).
	 */
	sighashes: Array<{
		inputIndex: number
		sighashHex: string
	}>
}

// ============================================================================
// Finalize action
// ============================================================================

/** Owner signature for one cosign-wrapped input. */
export interface CosignOwnerSig {
	inputIndex: number
	/** DER-encoded ECDSA signature, hex. */
	sigHex: string
	/** Owner's compressed public key, hex. */
	ownerPubkeyHex: string
}

export interface FinalizeCosignBsv21TransferInput {
	wallet: WalletInterface
	services: OneSatServices
	sessionId: string
	ownerSigs: CosignOwnerSig[]
	sessionStore: CosignSessionStore
}

/** Per-recipient delivery payload — backend forwards via messagebox. */
export interface CosignRecipientPayload {
	identityKey: string
	vout: number
	amount: string
	/** JSON string. Recipient passes this through to internalizeAction. */
	customInstructions: string
}

export interface FinalizeCosignBsv21TransferResult {
	txid: string
	/** Final atomic BEEF (signed, broadcast, admitted-or-pending). */
	beef: number[]
	/** Status from the overlay submit step. */
	overlayStatus: string
	/** Per-recipient delivery payloads for messagebox dispatch. */
	recipients: CosignRecipientPayload[]
}
