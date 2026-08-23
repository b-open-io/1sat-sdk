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
 * Every publish picks one directory layout (see {@link OrdfsDirWriteMode}):
 *   - `'mixed'` (default) — leaves are 0-sat B data and the root manifest is
 *     the only 1-sat ordinal. This produces one ownable directory asset.
 *   - `'inscription'` — every output is a 1-sat ord envelope.
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

import { P1SAT_INTENTS, P1SAT_PROTOCOL } from '@1sat/types'
import { Utils } from '@bsv/sdk'
import { prepareP1SatArgs } from '../apply'
import { ORDINALS_BASKET } from '../constants'
import { applyBapAip } from '../signing/aip'
import type { Action, ActionOptions, OneSatContext } from '../types'
import { executeTrackedAction } from '../utils/createTrackedAction'
import { executeSigmaAction } from '../utils/executeSigmaAction'
import { resolveDestination } from '../utils/resolveDestination'
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
	 * Directory output layout. Defaults to `'mixed'`. See the module doc comment for the ownership and
	 * signing implications of each mode.
	 */
	writeMode?: OrdfsDirWriteMode
	/**
	 * Sign the root manifest's authorship. Defaults to `true`. The signing
	 * PROTOCOL is derived from `writeMode` — not independently selectable —
	 * SIGMA when the root is an inscription, AIP for an all-B tree.
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
 * The default `mixed` layout writes 0-sat B leaves plus one wallet-locked
 * ordinal root. `inscription` locks every output; `b` writes every output as
 * plain 0-sat data. The root carries optional MAP metadata and, when `sign`
 * is true, the layout-appropriate authorship signature.
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
			'Publish an ord-fs/json directory with one ownable root by default, or all-inscription/all-B output layouts',
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
						"Output layout: 'mixed' uses B leaves plus one ordinal root; 'inscription' makes every output ownable; 'b' makes every output plain data.",
					enum: ['mixed', 'inscription', 'b'],
					default: 'mixed',
				},
				sign: {
					type: 'boolean',
					description:
						'Sign the root manifest. Uses SIGMA for mixed/inscription and AIP for b.',
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

			const writeMode: OrdfsDirWriteMode = input.writeMode ?? 'mixed'
			if (
				writeMode !== 'mixed' &&
				writeMode !== 'inscription' &&
				writeMode !== 'b'
			) {
				return { error: `invalid-write-mode: ${String(input.writeMode)}` }
			}

			const sign = input.sign ?? true

			// Decode base64 content into the raw bytes the output builder expects.
			const files: OrdfsDirFile[] = input.files.map((f) => ({
				path: f.path,
				content: new Uint8Array(Utils.toArray(f.base64Content, 'base64')),
				contentType: f.contentType,
			}))

			// Mixed and inscription layouts have at least one ordinal output, so
			// derive its spendable lock from the wallet. An all-B tree has no UTXO.
			const resolved =
				writeMode !== 'b'
					? await resolveDestination(ctx, undefined, {
							protocolID: P1SAT_PROTOCOL,
							keyIDPrefix: 'ordfs-dir',
						})
					: undefined
			// resolveDestination returns a wallet-derived self P2PKH locking
			// script; reuse it for whichever outputs are ordinal in this layout.
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

			if (writeMode !== 'b' && sign) {
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
 * manifest carries tags and is basketed as the tradeable ordinal for mixed
 * and all-inscription layouts. An all-B manifest owns nothing, so it isn't
 * tracked as an asset. File and subdirectory outputs are plumbing.
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
			if (writeMode !== 'b') {
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

	const args = await prepareP1SatArgs(
		ctx,
		{
			description: 'Publish ord-fs directory',
			outputs,
			options: {
				acceptDelayedBroadcast: false,
				randomizeOutputs: false,
			},
		},
		P1SAT_INTENTS.ORDFS_DEPLOY,
	)
	const result = await executeTrackedAction(
		ctx.wallet,
		args,
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
 * Publish with SIGMA authorship through the shared placeholder/seal apply
 * flow. Only called for signed mixed or all-inscription publishes.
 */
async function publishWithSigma(
	ctx: OneSatContext,
	built: BuiltOutputs,
	input: DeployOrdfsDirRequest,
	manifestCustomInstructions?: string,
): Promise<DeployOrdfsDirResponse> {
	const outputs = toActionOutputs(
		built,
		input.writeMode ?? 'mixed',
		manifestCustomInstructions,
	)
	const result = await executeSigmaAction(
		ctx,
		{
			description: 'Publish ord-fs directory',
			outputs,
			options: {
				randomizeOutputs: false,
				acceptDelayedBroadcast: true,
			},
		},
		P1SAT_INTENTS.ORDFS_DEPLOY_SIGMA,
		input.fundingProvider,
		built.manifestVout,
	)

	if (!result.txid) return { error: 'no-txid-returned' }

	return {
		txid: result.txid,
		manifestVout: built.manifestVout,
		origins: originsFor(result.txid, built.outputs.length),
		writeMode: input.writeMode ?? 'mixed',
	}
}

// ============================================================================
// Module exports
// ============================================================================

/** All ordfs directory-writing actions for the registry. */
export const ordfsActions = [deployOrdfsDir]
