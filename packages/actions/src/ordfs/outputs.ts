/**
 * ord-fs/json directory inscription output builder.
 *
 * Turns an ord-fs directory tree (see `buildOrdfsDirManifest`) into the set of
 * inscription outputs that publish it on-chain: one inscription per file, one
 * per subdirectory manifest, and a final root-manifest inscription. The root
 * manifest is the tradeable directory token and is the only output that may
 * carry MAP metadata and an AIP signature.
 *
 * This layer is locking-strategy agnostic (it accepts an address or a
 * per-vout locking-script resolver, so it works with a wallet-derived address
 * or a private-key address with no raw key required) and MAP agnostic (it
 * attaches whatever MAP suffix the caller supplies, without inventing fields).
 *
 * It deliberately does NOT attempt Sigma. Sigma binds a signature to a spent
 * input and therefore needs the spending transaction context, which only
 * exists inside the publishing action — see `inscribeOrdfsDir`.
 */

import { Inscription, MAP } from '@1sat/templates'
import { type LockingScript, P2PKH, Script, Utils } from '@bsv/sdk'
import { applyBapAip } from '../signing/aip'
import type { OneSatContext } from '../types'
import { type OrdfsDirManifest, buildOrdfsDirManifest } from './manifest'

/**
 * A file to include in an ord-fs directory inscription.
 *
 * Structurally identical to the registry's `PackageFile`, redeclared here so
 * the ordfs primitives carry no dependency on the registry module's types.
 */
export interface OrdfsDirFile {
	/** Relative path within the directory (e.g. `"SKILL.md"`, `"refs/api.md"`). */
	path: string
	/** File content as raw bytes. */
	content: Uint8Array
	/** MIME content type for the file inscription (e.g. `"text/markdown"`). */
	contentType: string
}

/**
 * Locking strategy for the inscription outputs.
 *
 * Either a single address applied to every output, or a resolver invoked once
 * per output index that returns the locking script for that vout. The resolver
 * form lets callers vary the lock per output (e.g. lock the root manifest to a
 * different key than the file inscriptions) without this module ever handling
 * a raw private key.
 */
export type OrdfsLocking =
	| { address: string }
	| { resolve: (vout: number) => LockingScript }

/**
 * Options for {@link buildOrdFsDirOutputs}.
 */
export interface BuildOrdFsDirOutputsOptions {
	/**
	 * Per-output locking strategy. Applied to file inscriptions, subdirectory
	 * manifests, and the root manifest alike. Required — there is no default,
	 * so the caller always controls who can spend the resulting outputs.
	 */
	locking: OrdfsLocking
	/**
	 * Optional MAP `SET` fields to attach to the ROOT manifest only. The fields
	 * are serialized with `MAP.set(map)` from `@1sat/templates` and appended to
	 * the manifest as a script suffix. This module stays MAP agnostic about
	 * which fields mean what: it writes whatever key-value pairs are supplied
	 * and never adds, drops, or rewrites them. File and subdirectory
	 * inscriptions never receive MAP.
	 */
	map?: Record<string, string>
	/**
	 * Optional pre-built suffix script to append to the root manifest AFTER the
	 * inscription envelope and AFTER {@link BuildOrdFsDirOutputsOptions.map},
	 * if any. Use this to attach already-composed BitCom protocol data (e.g. a
	 * MAP+AIP suffix produced elsewhere). Mutually informative with `map`/`aip`
	 * — all supplied suffixes are concatenated in the order map → suffix → aip.
	 */
	manifestSuffix?: Script
	/**
	 * Optional AIP signer for the ROOT manifest only. AIP signatures are
	 * transaction-independent (they sign the OP_RETURN data, not a spent
	 * input), so they can be applied here at output-build time. When set, the
	 * signer receives the root manifest's locking script (with any MAP suffix
	 * already attached) and must return it with an AIP suffix appended.
	 *
	 * NOTE: AIP is NOT bound to any input or transaction and is therefore
	 * replay-able — an attacker can copy the MAP+AIP data into an unrelated
	 * inscription. Prefer Sigma (applied in the publishing action, where the
	 * spending input is known) when authorship must be tamper-evident.
	 */
	aip?: (ctx: OneSatContext, manifestScript: Script) => Promise<Script>
}

/**
 * A single inscription output in an ord-fs directory publish transaction.
 */
export interface OrdfsDirOutput {
	/** Hex-encoded locking script (inscription envelope + any suffix). */
	lockingScriptHex: string
	/** Satoshi amount — always 1 for inscriptions. */
	satoshis: number
	/** Human-readable description of what this output carries. */
	description: string
	/** Whether this is the root manifest output (the directory's identity). */
	isManifest: boolean
}

/**
 * Result of {@link buildOrdFsDirOutputs}.
 */
export interface BuildOrdFsDirOutputsResult {
	/**
	 * All outputs in transaction order: file inscriptions, then subdirectory
	 * manifests, then the root manifest (last).
	 */
	outputs: OrdfsDirOutput[]
	/** Output index of the root manifest — equals `outputs.length - 1`. */
	manifestVout: number
	/** The computed directory tree layout, for callers that need the `_N` map. */
	tree: OrdfsDirManifest
}

/**
 * Resolve the locking script for a given output index from the strategy.
 */
function lockFor(locking: OrdfsLocking, vout: number): LockingScript {
	if ('address' in locking) {
		return new P2PKH().lock(locking.address)
	}
	return locking.resolve(vout)
}

/**
 * Build the inscription outputs that publish an ord-fs/json directory.
 *
 * Layout (matching {@link buildOrdfsDirManifest}):
 *   [0..F-1]   one 1-sat inscription per file, in `files` order
 *   [F..F+D-1] one 1-sat inscription per subdirectory manifest
 *   [F+D]      the root manifest inscription (MAP + AIP suffix, if supplied)
 *
 * The root manifest is the last output and the only one that receives MAP
 * metadata or an AIP signature. Sigma is intentionally NOT applied here; bind
 * authorship to a spent input in the publishing action instead.
 *
 * @param files - Files to inscribe, in the order their outputs are created.
 *   Paths use `/` for subdirectories (e.g. `"refs/api.md"`).
 * @param opts - Locking strategy plus optional MAP suffix, extra manifest
 *   suffix, and AIP signer for the root manifest.
 * @param ctx - Action context, forwarded to the AIP signer when one is given.
 *   May be omitted when no AIP signer is supplied.
 * @returns The ordered outputs, the root manifest's vout, and the computed
 *   directory tree.
 */
export async function buildOrdFsDirOutputs(
	files: OrdfsDirFile[],
	opts: BuildOrdFsDirOutputsOptions,
	ctx?: OneSatContext,
): Promise<BuildOrdFsDirOutputsResult> {
	const tree = buildOrdfsDirManifest(files)
	const outputs: OrdfsDirOutput[] = []

	// -------------------------------------------------------------------
	// 1. File inscription outputs (vouts 0..F-1)
	// -------------------------------------------------------------------
	for (let i = 0; i < files.length; i++) {
		const file = files[i]
		const inscription = Inscription.create(file.content, file.contentType, {
			scriptPrefix: lockFor(opts.locking, i),
		})
		outputs.push({
			lockingScriptHex: Utils.toHex(inscription.lock().toBinary()),
			satoshis: 1,
			description: `file: ${file.path}`,
			isManifest: false,
		})
	}

	// -------------------------------------------------------------------
	// 2. Subdirectory manifest inscriptions (vouts F..F+D-1)
	// -------------------------------------------------------------------
	for (const subdir of tree.subdirs) {
		const subdirBytes = new Uint8Array(
			Utils.toArray(JSON.stringify(subdir.manifest), 'utf8'),
		)
		const inscription = Inscription.create(
			subdirBytes,
			tree.manifestContentType,
			{ scriptPrefix: lockFor(opts.locking, subdir.vout) },
		)
		outputs.push({
			lockingScriptHex: Utils.toHex(inscription.lock().toBinary()),
			satoshis: 1,
			description: `dir: ${subdir.name}/`,
			isManifest: false,
		})
	}

	// -------------------------------------------------------------------
	// 3. Root manifest inscription (last output)
	//    Compose the suffix: MAP (if any) → caller suffix (if any).
	//    AIP is applied to the finished locking script afterward, since it
	//    must sign over the MAP data already present.
	// -------------------------------------------------------------------
	const manifestBytes = new Uint8Array(
		Utils.toArray(JSON.stringify(tree.root), 'utf8'),
	)

	const hasMap = opts.map && Object.keys(opts.map).length > 0
	let suffix: Script | undefined
	if (hasMap || opts.manifestSuffix) {
		suffix = new Script()
		if (hasMap && opts.map) {
			for (const chunk of MAP.set(opts.map).chunks) suffix.chunks.push(chunk)
		}
		if (opts.manifestSuffix) {
			for (const chunk of opts.manifestSuffix.chunks) suffix.chunks.push(chunk)
		}
	}

	const manifestInscription = Inscription.create(
		manifestBytes,
		tree.manifestContentType,
		{
			scriptPrefix: lockFor(opts.locking, tree.manifestVout),
			...(suffix ? { scriptSuffix: suffix } : {}),
		},
	)
	let manifestScript = new Script(manifestInscription.lock().chunks)

	if (opts.aip) {
		if (!ctx) {
			throw new Error(
				'buildOrdFsDirOutputs: an AIP signer was supplied but no context was provided',
			)
		}
		manifestScript = await opts.aip(ctx, manifestScript)
	}

	outputs.push({
		lockingScriptHex: Utils.toHex(manifestScript.toBinary()),
		satoshis: 1,
		description: 'manifest (ord-fs/json)',
		isManifest: true,
	})

	return {
		outputs,
		manifestVout: tree.manifestVout,
		tree,
	}
}

/**
 * Convenience AIP signer that signs the root manifest with the wallet's
 * current BAP key, for use as {@link BuildOrdFsDirOutputsOptions.aip}.
 *
 * Replay caveat applies — see the `aip` option's note.
 */
export function bapAipSigner(
	keyID?: string,
): (ctx: OneSatContext, manifestScript: Script) => Promise<Script> {
	return (ctx, manifestScript) => applyBapAip(ctx, manifestScript, keyID)
}
