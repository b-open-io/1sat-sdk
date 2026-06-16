/**
 * ord-fs/json directory writing.
 *
 * Three layered primitives for publishing a directory of files as a single
 * on-chain ord-fs/json tree:
 *
 *   1. `buildOrdfsDirManifest` — pure `_N` relative-vout tree layout.
 *   2. `buildOrdFsDirOutputs`  — inscription outputs on top of (1), with a
 *      pluggable locking strategy, optional MAP, and optional AIP.
 *   3. `inscribeOrdfsDir`      — the wallet-based publishing action, which adds
 *      Sigma authorship (the default) by binding the manifest tx to a spent
 *      anchor input.
 *
 * Layering keeps the pure tree logic testable and reusable, the output builder
 * key-agnostic, and the transaction/Sigma concerns confined to the action.
 */

import { P2PKH, PublicKey, Script } from '@bsv/sdk'
import { ORDINALS_BASKET, P1SAT_PROTOCOL, SIGMA_BASKET } from '../constants'
import { applyBapAip } from '../signing/aip'
import { applySigma } from '../signing/sigma'
import type { Action, ActionOptions, OneSatContext } from '../types'
import { executeTrackedAction } from '../utils/createTrackedAction'
import { resolveDestination } from '../utils/resolveDestination'
import { signP2PKHInput } from '../utils/signP2PKH'
import { buildOrdFsDirOutputs } from './outputs'
import type { OrdfsDirFile } from './outputs'

export { buildOrdfsDirManifest } from './manifest'
export type {
	OrdfsDirManifest,
	OrdfsSubdirManifest,
} from './manifest'
export { buildOrdFsDirOutputs, bapAipSigner } from './outputs'
export type {
	BuildOrdFsDirOutputsOptions,
	BuildOrdFsDirOutputsResult,
	OrdfsDirFile,
	OrdfsDirOutput,
	OrdfsLocking,
} from './outputs'

// ============================================================================
// Types
// ============================================================================

/**
 * Authorship signing mode for the published directory's root manifest.
 *
 * - `'sigma'` (default) — bind a SIGMA signature to a spent anchor input so the
 *   signature is only valid in this exact transaction (replay-resistant).
 * - `'aip'` — sign the root manifest's MAP data with AIP. Simpler, but NOT
 *   bound to the transaction: the MAP+AIP data can be copied verbatim into an
 *   unrelated inscription, so AIP authorship is replay-able.
 * - `'none'` — publish unsigned.
 */
export type OrdfsDirSignMode = 'sigma' | 'aip' | 'none'

export interface InscribeOrdfsDirRequest extends ActionOptions {
	/**
	 * Files to publish, in the order their inscriptions are created. Paths use
	 * `/` for subdirectories (e.g. `"SKILL.md"`, `"refs/api.md"`).
	 */
	files: OrdfsDirFile[]
	/**
	 * Optional MAP `SET` fields written to the root manifest only. Caller owns
	 * field semantics; the action attaches them verbatim.
	 */
	map?: Record<string, string>
	/**
	 * Authorship signing mode for the root manifest. Defaults to `'sigma'`.
	 */
	sign?: OrdfsDirSignMode
}

export interface InscribeOrdfsDirResponse {
	/** Transaction ID of the publish transaction, when broadcast succeeded. */
	txid?: string
	/** Output index of the root manifest within the transaction. */
	manifestVout?: number
	/**
	 * Origins for every inscription output, as `"{txid}_{vout}"`. Parallel to
	 * the output layout: files first, then subdirectory manifests, then the
	 * root manifest (last). The root manifest origin is `origins[manifestVout]`.
	 */
	origins?: string[]
	/** Error message when the publish failed. */
	error?: string
}

// ============================================================================
// Action
// ============================================================================

/**
 * Publish a directory of files as a single on-chain ord-fs/json tree using a
 * BRC-100 wallet.
 *
 * Output layout (see {@link buildOrdfsDirManifest}):
 *   [0..F-1]   one inscription per file
 *   [F..F+D-1] one inscription per subdirectory manifest
 *   [F+D]      the root manifest (the tradeable directory token)
 *
 * Every output is locked to a wallet-derived self address (via
 * {@link resolveDestination}). The root manifest carries the optional MAP and
 * the chosen authorship signature; file and subdirectory inscriptions are
 * unsigned plumbing.
 *
 * Signing modes (see {@link OrdfsDirSignMode}):
 *   - `'sigma'` (default): a 2-sat anchor output is created and immediately
 *     spent by the publish tx. The root manifest's SIGMA signature is bound to
 *     that anchor outpoint, so it is only valid in this transaction — an
 *     attacker cannot replay the signed manifest into a different tx. This
 *     mirrors the single-inscription Sigma anchor flow.
 *   - `'aip'`: the root manifest's MAP data is AIP-signed with the wallet's
 *     current BAP key. Simpler and tx-independent, but the MAP+AIP bytes can be
 *     copied into an unrelated inscription, so authorship is replay-able. This
 *     is why Sigma is the default.
 *   - `'none'`: published unsigned.
 *
 * @param ctx - Action context carrying the BRC-100 wallet.
 * @param input - Files, optional MAP fields, optional signing mode, and
 *   optional funding provider.
 * @returns The publish txid, the root manifest vout, and the per-output
 *   origins — or an `error` string on failure.
 */
export const inscribeOrdfsDir: Action<
	InscribeOrdfsDirRequest,
	InscribeOrdfsDirResponse
> = {
	meta: {
		name: 'inscribeOrdfsDir',
		description:
			'Publish a directory of files as a single on-chain ord-fs/json tree (Sigma-signed by default)',
		category: 'inscriptions',
		inputSchema: {
			type: 'object',
			properties: {
				files: {
					type: 'array',
					description:
						'Files to publish. Each has { path, content (bytes), contentType }. Paths may contain "/" for subdirectories.',
					items: {
						type: 'object',
						properties: {
							path: { type: 'string', description: 'Relative file path' },
							contentType: { type: 'string', description: 'MIME content type' },
						},
						required: ['path', 'content', 'contentType'],
					},
				},
				map: {
					type: 'object',
					description: 'Optional MAP SET fields for the root manifest',
					properties: {},
				},
				sign: {
					type: 'string',
					description:
						'Authorship signing mode for the root manifest. Sigma is replay-resistant; AIP is replay-able.',
					enum: ['sigma', 'aip', 'none'],
					default: 'sigma',
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

			const signMode: OrdfsDirSignMode = input.sign ?? 'sigma'

			// Derive a wallet self address to lock every output to. Using a
			// single resolved address (rather than the raw key) keeps the output
			// builder key-agnostic while remaining wallet-controlled.
			const resolved = await resolveDestination(ctx, undefined, {
				protocolID: P1SAT_PROTOCOL,
				keyIDPrefix: 'ordfs-dir',
			})
			// resolveDestination returns a wallet-derived self P2PKH locking
			// script; reuse it verbatim for every output via the resolver
			// strategy, which keeps the output builder key-agnostic.
			const lockingScript = resolved.lockingScript

			// AIP can be applied at output-build time (it is tx-independent), so
			// fold it in here when requested. Sigma needs the spending input and
			// is applied to the manifest after the anchor exists (below).
			const built = await buildOrdFsDirOutputs(
				input.files,
				{
					locking: { resolve: () => lockingScript },
					map: input.map,
					...(signMode === 'aip'
						? {
								aip: (c: OneSatContext, manifestScript: Script) =>
									applyBapAip(c, manifestScript),
							}
						: {}),
				},
				ctx,
			)

			const customInstructions = resolved.customInstructions
				? JSON.stringify({
						protocolID: resolved.customInstructions.protocolID,
						keyID: resolved.customInstructions.keyID,
					})
				: undefined

			if (signMode === 'sigma') {
				return await publishWithSigma(ctx, built, input, customInstructions)
			}

			return await publishOutputs(ctx, built, input, customInstructions)
		} catch (error) {
			if (ctx.debug && ctx.log) {
				ctx.log({
					timestamp: new Date().toISOString(),
					action: 'inscribeOrdfsDir',
					input: { fileCount: input.files?.length, sign: input.sign },
					error: error instanceof Error ? error.message : 'unknown-error',
				})
			}
			return { error: error instanceof Error ? error.message : 'unknown-error' }
		}
	},
}

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
 * manifest is basketed/tracked as the tradeable ordinal; file and subdirectory
 * inscriptions are plumbing and carry no basket.
 *
 * When `manifestScriptOverride` is supplied (the Sigma-signed script), it
 * replaces the root manifest's locking script.
 */
function toActionOutputs(
	built: BuiltOutputs,
	manifestCustomInstructions?: string,
	manifestScriptOverride?: string,
): PublishOutput[] {
	return built.outputs.map((o) => {
		const out: PublishOutput = {
			lockingScript:
				o.isManifest && manifestScriptOverride
					? manifestScriptOverride
					: o.lockingScriptHex,
			satoshis: o.satoshis,
			outputDescription: o.description.slice(0, 50),
		}
		if (o.isManifest) {
			out.basket = ORDINALS_BASKET
			out.tags = ['type:ord-fs/json', 'origin']
			out.customInstructions = manifestCustomInstructions
		}
		return out
	})
}

/**
 * Publish the outputs directly (AIP or unsigned modes) — no anchor input.
 */
async function publishOutputs(
	ctx: OneSatContext,
	built: BuiltOutputs,
	input: InscribeOrdfsDirRequest,
	manifestCustomInstructions?: string,
): Promise<InscribeOrdfsDirResponse> {
	const outputs = toActionOutputs(built, manifestCustomInstructions)

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
	}
}

/**
 * Publish with Sigma authorship: create a 2-sat anchor, bind the root
 * manifest's SIGMA signature to the anchor outpoint, then spend the anchor in
 * the publish transaction so the signature is only valid here.
 */
async function publishWithSigma(
	ctx: OneSatContext,
	built: BuiltOutputs,
	input: InscribeOrdfsDirRequest,
	manifestCustomInstructions?: string,
): Promise<InscribeOrdfsDirResponse> {
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

	// Bind the SIGMA signature to (anchorTxid, 0). The signature commits to the
	// root manifest's locking script AND that exact input, so it is only valid
	// in a tx that spends the anchor — replay-resistant. The manifest sits at
	// the LAST output, so targetVout = manifestVout; the anchor is vin 0.
	const manifestScript = Script.fromHex(
		built.outputs[built.manifestVout].lockingScriptHex,
	)
	const sigmaScript = await applySigma(
		ctx,
		manifestScript,
		{ txid: anchorResult.txid, vout: 0 },
		built.manifestVout,
		0,
	)

	// Replace the manifest output's script with the Sigma-signed version.
	const outputs = toActionOutputs(
		built,
		manifestCustomInstructions,
		sigmaScript.toHex(),
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
	}
}

// ============================================================================
// Module exports
// ============================================================================

/** All ordfs directory-writing actions for the registry. */
export const ordfsActions = [inscribeOrdfsDir]
