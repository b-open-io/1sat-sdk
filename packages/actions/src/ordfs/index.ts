/**
 * ord-fs/json directory writing.
 *
 * Three layered primitives for publishing a directory of files as a single
 * on-chain ord-fs/json tree:
 *
 *   1. `buildOrdfsDirManifest` — pure `_N` relative-vout tree layout.
 *   2. `buildOrdFsDirOutputs`  — outputs on top of (1), for either write mode
 *      (see below), with a pluggable locking strategy and optional MAP/AIP.
 *   3. `deployOrdfsDir`        — the wallet-based publishing action.
 *
 * Layering keeps the pure tree logic testable and reusable, the output builder
 * key-agnostic, and the transaction/Sigma concerns confined to the action.
 *
 * Every publish picks one write mode for the whole tree — there is no
 * per-file mode in this action (see {@link OrdfsDirWriteMode}):
 *   - `'inscription'` (default) — every output is a 1-sat ord envelope.
 *     Ownable, transferable, updatable; holds a UTXO. Authorship, when
 *     signed, uses SIGMA: it binds the root manifest to a spent anchor input
 *     so the signature only validates in this exact transaction.
 *   - `'b'` — every output is a 0-sat B protocol output. Plain on-chain data,
 *     not an ordinal: nothing is owned, no UTXO is held. Authorship, when
 *     signed, uses AIP: it signs the manifest's OP_RETURN data directly
 *     (replay-able — the signed bytes could be copied into an unrelated
 *     output — but there's no spendable UTXO to bind a SIGMA anchor to).
 *
 * The signing PROTOCOL is not an independent choice: it is determined by
 * `writeMode`. Callers only choose whether to sign at all (`sign`), matching
 * how these two protocols actually work — SIGMA requires a UTXO to spend,
 * AIP does not.
 */

import { P2PKH, PublicKey, Utils } from '@bsv/sdk'
import { ORDINALS_BASKET, P1SAT_PROTOCOL, SIGMA_BASKET } from '../constants'
import { applyBapAip } from '../signing/aip'
import { applySigma } from '../signing/sigma'
import type { Action, ActionOptions, OneSatContext } from '../types'
import { executeTrackedAction } from '../utils/createTrackedAction'
import { resolveDestination } from '../utils/resolveDestination'
import { signP2PKHInput } from '../utils/signP2PKH'
import { buildOrdFsDirOutputs } from './outputs'
import type { OrdfsDirFile, OrdfsDirWriteMode } from './outputs'

export { buildOrdfsDirManifest, MAX_ORDFS_DIRECTORY_DEPTH } from './manifest'
export type {
	OrdfsDirManifest,
	OrdfsSubdirManifest,
} from './manifest'
export { buildOrdFsDirOutputs } from './outputs'
export type {
	BuildOrdFsDirOutputsOptions,
	BuildOrdFsDirOutputsResult,
	OrdfsDirFile,
	OrdfsDirOutput,
	OrdfsDirWriteMode,
	OrdfsLocking,
} from './outputs'

// ============================================================================
// Types
// ============================================================================

/**
 * A file to publish, as accepted by the {@link deployOrdfsDir} action.
 *
 * Content is base64 so the action's input is JSON/MCP-serializable (the lower
 * level {@link buildOrdFsDirOutputs} works with raw `Uint8Array` bytes; this
 * action decodes `base64Content` for callers).
 */
export interface DeployOrdfsDirFile {
	/** Relative path; use `/` for subdirectories (e.g. `"refs/api.md"`). */
	path: string
	/** Base64-encoded file bytes. */
	base64Content: string
	/** MIME content type for the file inscription. */
	contentType: string
}

/** @deprecated Use {@link DeployOrdfsDirFile}. */
export type InscribeOrdfsDirFile = DeployOrdfsDirFile

export interface DeployOrdfsDirRequest extends ActionOptions {
	/**
	 * Files to publish, in the order their outputs are created. Paths use
	 * `/` for subdirectories (e.g. `"SKILL.md"`, `"refs/api.md"`).
	 */
	files: DeployOrdfsDirFile[]
	/**
	 * Optional MAP `SET` fields written to the root manifest only. Caller owns
	 * field semantics; the action attaches them verbatim.
	 */
	map?: Record<string, string>
	/**
	 * How every output in the tree is written on-chain. Defaults to
	 * `'inscription'`. See the module doc comment for the ownership and
	 * signing implications of each mode.
	 */
	writeMode?: OrdfsDirWriteMode
	/**
	 * Sign the root manifest's authorship. Defaults to `true`. The signing
	 * PROTOCOL is derived from `writeMode` — not independently selectable —
	 * SIGMA for `'inscription'`, AIP for `'b'`.
	 */
	sign?: boolean
}

/** @deprecated Use {@link DeployOrdfsDirRequest}. */
export type InscribeOrdfsDirRequest = DeployOrdfsDirRequest

export interface DeployOrdfsDirResponse {
	/** Transaction ID of the publish transaction, when broadcast succeeded. */
	txid?: string
	/** Output index of the root manifest within the transaction. */
	manifestVout?: number
	/**
	 * Origins for every output, as `"{txid}_{vout}"`. Parallel to the output
	 * layout: files first, then subdirectory manifests, then the root
	 * manifest (last). The root manifest origin is `origins[manifestVout]`.
	 * For `writeMode: 'b'` these are on-chain locations for reference only —
	 * nothing at them is a spendable/ownable ordinal.
	 */
	origins?: string[]
	/** The write mode actually used, echoed back for convenience. */
	writeMode?: OrdfsDirWriteMode
	/** Error message when the publish failed. */
	error?: string
}

/** @deprecated Use {@link DeployOrdfsDirResponse}. */
export type InscribeOrdfsDirResponse = DeployOrdfsDirResponse

// ============================================================================
// Action
// ============================================================================

/**
 * Publish a directory of files as a single on-chain ord-fs/json tree using a
 * BRC-100 wallet.
 *
 * Output layout (see {@link buildOrdfsDirManifest}):
 *   [0..F-1]   one output per file
 *   [F..F+D-1] one output per subdirectory manifest
 *   [F+D]      the root manifest (the directory's identity)
 *
 * For `writeMode: 'inscription'` (default), every output is locked to a
 * wallet-derived self address (via {@link resolveDestination}) and holds a
 * UTXO. For `writeMode: 'b'`, every output is a 0-sat OP_RETURN and nothing
 * is locked or held. The root manifest carries the optional MAP and, when
 * `sign` is true, the mode-derived authorship signature; file and
 * subdirectory outputs are unsigned plumbing either way.
 *
 * @param ctx - Action context carrying the BRC-100 wallet.
 * @param input - Files, optional MAP fields, write mode, sign flag, and
 *   optional funding provider.
 * @returns The publish txid, the root manifest vout, the per-output origins,
 *   and the write mode used — or an `error` string on failure.
 */
export const deployOrdfsDir: Action<
	DeployOrdfsDirRequest,
	DeployOrdfsDirResponse
> = {
	meta: {
		name: 'deployOrdfsDir',
		description:
			'Publish a directory of files as a single on-chain ord-fs/json tree, as either 1-sat inscriptions (ownable) or 0-sat B uploads (plain data)',
		category: 'inscriptions',
		inputSchema: {
			type: 'object',
			properties: {
				files: {
					type: 'array',
					description:
						'Files to publish. Each has { path, base64Content, contentType }. Paths may contain "/" for subdirectories.',
					items: {
						type: 'object',
						properties: {
							path: { type: 'string', description: 'Relative file path' },
							base64Content: {
								type: 'string',
								description: 'Base64-encoded file bytes',
							},
							contentType: { type: 'string', description: 'MIME content type' },
						},
						required: ['path', 'base64Content', 'contentType'],
					},
				},
				map: {
					type: 'object',
					description: 'Optional MAP SET fields for the root manifest',
					properties: {},
				},
				writeMode: {
					type: 'string',
					description:
						"How every output is written on-chain: '1sat' inscriptions (ownable, hold a UTXO) or 0-sat B uploads (plain data, nothing owned).",
					enum: ['inscription', 'b'],
					default: 'inscription',
				},
				sign: {
					type: 'boolean',
					description:
						'Sign the root manifest. Protocol is derived from writeMode: SIGMA for inscription, AIP for b.',
					default: true,
				},
			},
			required: ['files'],
		},
	},
	async execute(ctx, input) {
		try {
			if (!input.files || input.files.length === 0) {
				return { error: 'no-files' }
			}

			const writeMode: OrdfsDirWriteMode = input.writeMode ?? 'inscription'
			if (writeMode !== 'inscription' && writeMode !== 'b') {
				return { error: `invalid-write-mode: ${String(input.writeMode)}` }
			}

			const sign = input.sign ?? true

			// SIGMA binds authorship to a wallet-signed anchor input. An external
			// funding provider builds/broadcasts the tx itself and does not run the
			// caller's anchor-signing callback, so the anchor would be left
			// unsigned. Fail informatively instead of broadcasting a broken tx.
			// This only applies to signed 'inscription' publishes — AIP (used for
			// 'b') signs at build time and has no anchor to co-sign.
			if (writeMode === 'inscription' && sign && input.fundingProvider) {
				return {
					error:
						'sigma-incompatible-with-funding-provider: use sign:false or writeMode:"b" with an external funding provider',
				}
			}

			// Decode base64 content into the raw bytes the output builder expects.
			const files: OrdfsDirFile[] = input.files.map((f) => ({
				path: f.path,
				content: new Uint8Array(Utils.toArray(f.base64Content, 'base64')),
				contentType: f.contentType,
			}))

			// 'inscription' outputs hold a UTXO and need a spendable lock, derived
			// from the wallet. 'b' outputs are 0-sat OP_RETURN data with nothing to
			// own, so there's no destination to resolve.
			const resolved =
				writeMode === 'inscription'
					? await resolveDestination(ctx, undefined, {
							protocolID: P1SAT_PROTOCOL,
							keyIDPrefix: 'ordfs-dir',
						})
					: undefined
			// resolveDestination returns a wallet-derived self P2PKH locking
			// script; reuse it verbatim for every output via the resolver
			// strategy, which keeps the output builder key-agnostic.
			const lockingScript = resolved?.lockingScript

			// AIP can be applied at output-build time (it is tx-independent), so
			// fold it in here for a signed 'b' publish. SIGMA needs the spending
			// input and is applied to the manifest after the anchor exists (below).
			const built = await buildOrdFsDirOutputs(
				files,
				{
					writeMode,
					...(lockingScript
						? { locking: { resolve: () => lockingScript } }
						: {}),
					map: input.map,
					...(writeMode === 'b' && sign ? { aip: applyBapAip } : {}),
				},
				ctx,
			)

			const customInstructions = resolved?.customInstructions
				? JSON.stringify({
						protocolID: resolved.customInstructions.protocolID,
						keyID: resolved.customInstructions.keyID,
					})
				: undefined

			if (writeMode === 'inscription' && sign) {
				return await publishWithSigma(ctx, built, input, customInstructions)
			}

			return await publishOutputs(
				ctx,
				built,
				input,
				writeMode,
				customInstructions,
			)
		} catch (error) {
			if (ctx.debug && ctx.log) {
				ctx.log({
					timestamp: new Date().toISOString(),
					action: 'deployOrdfsDir',
					input: {
						fileCount: input.files?.length,
						writeMode: input.writeMode,
						sign: input.sign,
					},
					error: error instanceof Error ? error.message : 'unknown-error',
				})
			}
			return { error: error instanceof Error ? error.message : 'unknown-error' }
		}
	},
}

/** @deprecated Use {@link deployOrdfsDir}. */
export const inscribeOrdfsDir = deployOrdfsDir

/** @deprecated Use {@link deployOrdfsDir}. */
export const uploadOrdfsDir = deployOrdfsDir

// ============================================================================
// Internal publish helpers
// ============================================================================

type BuiltOutputs = Awaited<ReturnType<typeof buildOrdFsDirOutputs>>

/**
 * Map a publish txid onto every output's origin (`"{txid}_{vout}"`).
 */
function originsFor(txid: string, count: number): string[] {
	return Array.from({ length: count }, (_, i) => `${txid}_${i}`)
}

interface PublishOutput {
	lockingScript: string
	satoshis: number
	outputDescription: string
	basket?: string
	tags?: string[]
	customInstructions?: string
}

/**
 * Convert the built outputs into createAction output specs. Only the root
 * manifest carries tags; it's basketed as the tradeable ordinal only for
 * `writeMode: 'inscription'` — a `'b'` manifest owns nothing, so it isn't
 * tracked as an asset. File and subdirectory outputs are plumbing either way.
 */
function toActionOutputs(
	built: BuiltOutputs,
	writeMode: OrdfsDirWriteMode,
	manifestCustomInstructions?: string,
): PublishOutput[] {
	return built.outputs.map((o) => {
		const out: PublishOutput = {
			lockingScript: o.lockingScriptHex,
			satoshis: o.satoshis,
			outputDescription: o.description.slice(0, 50),
		}
		if (o.isManifest) {
			out.tags = ['type:ord-fs/json', 'origin']
			if (writeMode === 'inscription') {
				out.basket = ORDINALS_BASKET
				out.customInstructions = manifestCustomInstructions
			}
		}
		return out
	})
}

/**
 * Publish the outputs directly — used for unsigned publishes (either write
 * mode) and for signed `writeMode: 'b'` publishes (AIP is already folded into
 * `built` by the caller; there's no anchor to spend).
 */
async function publishOutputs(
	ctx: OneSatContext,
	built: BuiltOutputs,
	input: DeployOrdfsDirRequest,
	writeMode: OrdfsDirWriteMode,
	manifestCustomInstructions?: string,
): Promise<DeployOrdfsDirResponse> {
	const outputs = toActionOutputs(built, writeMode, manifestCustomInstructions)

	const result = await executeTrackedAction(
		ctx.wallet,
		{
			description: 'Publish ord-fs directory',
			outputs,
			options: {
				acceptDelayedBroadcast: false,
				randomizeOutputs: false,
			},
		},
		input.fundingProvider,
	)

	if (!result.txid) return { error: 'no-txid-returned' }

	return {
		txid: result.txid,
		manifestVout: built.manifestVout,
		origins: originsFor(result.txid, built.outputs.length),
		writeMode,
	}
}

/**
 * Publish with SIGMA authorship: create a 2-sat anchor, bind the root
 * manifest's SIGMA signature to the anchor outpoint, then spend the anchor in
 * the publish transaction so the signature is only valid here. Only called
 * for signed `writeMode: 'inscription'` publishes.
 */
async function publishWithSigma(
	ctx: OneSatContext,
	built: BuiltOutputs,
	input: DeployOrdfsDirRequest,
	manifestCustomInstructions?: string,
): Promise<DeployOrdfsDirResponse> {
	const anchorKeyID = `anchor-${Date.now()}`
	const { publicKey: anchorPubKey } = await ctx.wallet.getPublicKey({
		protocolID: P1SAT_PROTOCOL,
		keyID: anchorKeyID,
		counterparty: 'self',
		forSelf: true,
	})
	const anchorAddress = PublicKey.fromString(anchorPubKey).toAddress()
	const anchorLockingScript = new P2PKH().lock(anchorAddress)

	// Step 1: anchor tx (signed, not broadcast). A 2-sat lock-in UTXO that
	// exists only so the publish tx can spend it to produce the SIGMA
	// signature. Bypass P1SAT tracking — this is internal plumbing.
	const anchorResult = await executeTrackedAction(
		ctx.wallet,
		{
			description: 'Sigma anchor output',
			outputs: [
				{
					lockingScript: anchorLockingScript.toHex(),
					satoshis: 2,
					outputDescription: 'Sigma anchor',
					basket: SIGMA_BASKET,
					customInstructions: JSON.stringify({
						protocolID: P1SAT_PROTOCOL,
						keyID: anchorKeyID,
					}),
				},
			],
			options: {
				noSend: true,
				randomizeOutputs: false,
				acceptDelayedBroadcast: true,
			},
		},
		input.fundingProvider,
		undefined,
		undefined,
		{ bypassP1Sat: true },
	)

	if (!anchorResult.txid) return { error: 'anchor-no-txid' }

	// Bind the SIGMA signature to (anchorTxid, 0). It commits to the root
	// manifest script and that exact input, so it only validates in a tx that
	// spends the anchor. The manifest is the last output (vout = manifestVout);
	// the anchor is vin 0.
	const sigmaScript = await applySigma(
		ctx,
		built.manifestScript,
		{ txid: anchorResult.txid, vout: 0 },
		built.manifestVout,
		0,
	)

	// Swap in the Sigma-signed manifest script, then emit the outputs.
	built.outputs[built.manifestVout].lockingScriptHex = sigmaScript.toHex()
	const outputs = toActionOutputs(
		built,
		'inscription',
		manifestCustomInstructions,
	)

	// Step 2: publish tx, spending the anchor and broadcasting both.
	const result = await executeTrackedAction(
		ctx.wallet,
		{
			description: 'Publish ord-fs directory',
			inputBEEF: anchorResult.tx,
			inputs: [
				{
					outpoint: `${anchorResult.txid}.0`,
					inputDescription: 'Sigma anchor',
					unlockingScriptLength: 108,
				},
			],
			outputs,
			options: {
				randomizeOutputs: false,
				noSend: true,
				noSendChange: anchorResult.noSendChange,
				knownTxids: [anchorResult.txid],
				acceptDelayedBroadcast: true,
				trustSelf: 'known',
				sendWith: [anchorResult.txid],
			},
		},
		input.fundingProvider,
		anchorResult.tx as number[],
		async (tx) => {
			const unlocking = await signP2PKHInput(
				ctx,
				tx,
				0,
				P1SAT_PROTOCOL,
				anchorKeyID,
			)
			if (typeof unlocking !== 'string') throw new Error(unlocking.error)
			return { 0: { unlockingScript: unlocking } }
		},
	)

	if (!result.txid) return { error: 'no-txid-returned' }

	return {
		txid: result.txid,
		manifestVout: built.manifestVout,
		origins: originsFor(result.txid, built.outputs.length),
		writeMode: 'inscription',
	}
}

// ============================================================================
// Module exports
// ============================================================================

/** All ordfs directory-writing actions for the registry. */
export const ordfsActions = [deployOrdfsDir]
