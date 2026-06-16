/**
 * Builds the inscription outputs for an ord-fs/json directory: one per file,
 * one per subdirectory manifest, and the root manifest last. The root manifest
 * is the directory token and the only output that carries MAP or an AIP
 * signature.
 *
 * Locking is pluggable (an address or a per-vout resolver), so this never
 * touches a raw private key, and MAP is whatever the caller passes. Sigma isn't
 * applied here — it needs the spending input, which only exists in the
 * publishing action (`inscribeOrdfsDir`).
 */

import { Inscription, MAP } from '@1sat/templates'
import { type LockingScript, P2PKH, Script, Utils } from '@bsv/sdk'
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
 * An address applied to every output, or a resolver that returns the locking
 * script per vout. The resolver lets callers vary the lock per output without
 * exposing a raw private key here.
 */
export type OrdfsLocking =
	| { address: string }
	| { resolve: (vout: number) => LockingScript }

/**
 * Options for {@link buildOrdFsDirOutputs}.
 */
export interface BuildOrdFsDirOutputsOptions {
	/** Locking applied to every output. Required, so the caller controls who can spend them. */
	locking: OrdfsLocking
	/**
	 * MAP fields for the root manifest only, serialized with `MAP.set` and
	 * appended as a suffix. Written as given — nothing added or rewritten.
	 */
	map?: Record<string, string>
	/**
	 * AIP signer for the root manifest. Receives the manifest script (with any
	 * MAP suffix) and returns it with an AIP suffix. AIP signs the OP_RETURN
	 * data rather than a spent input, so it's replay-able — prefer Sigma (in the
	 * action) when authorship needs to be tamper-evident.
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
	/** The root manifest's locking script (with MAP/AIP suffix), for signing. */
	manifestScript: Script
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
 * @param files - Files to inscribe, in the order their outputs are created.
 *   Paths use `/` for subdirectories (e.g. `"refs/api.md"`).
 * @param opts - Locking strategy plus optional MAP and AIP signer for the root
 *   manifest.
 * @param ctx - Forwarded to the AIP signer; may be omitted when none is given.
 * @returns The outputs, the root manifest's vout and script, and the tree.
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
	// 3. Root manifest inscription (last output). MAP goes on as a suffix;
	//    AIP is applied afterward, since it signs over the MAP data.
	// -------------------------------------------------------------------
	const manifestBytes = new Uint8Array(
		Utils.toArray(JSON.stringify(tree.root), 'utf8'),
	)

	const suffix =
		opts.map && Object.keys(opts.map).length > 0 ? MAP.set(opts.map) : undefined

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
		manifestScript,
		tree,
	}
}
