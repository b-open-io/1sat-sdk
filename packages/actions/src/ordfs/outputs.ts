/**
 * Builds the outputs for an ord-fs/json directory: one per file, one per
 * subdirectory manifest, and the root manifest last. The root manifest is the
 * directory's identity and the only output that carries MAP or a signature.
 *
 * Outputs are written in one of three layouts, chosen by
 * `writeMode` (see {@link OrdfsDirWriteMode}):
 *   - `'mixed'` — 0-sat B leaves and one 1-sat root inscription. This is the
 *     default: the directory has one ownable token without a UTXO per file.
 *   - `'inscription'` — a 1-sat ord envelope, built on the shared
 *     `Inscription` template. Ownable/transferable/updatable; holds a UTXO.
 *   - `'b'` — a 0-sat B protocol (bitcom `B://`) output, built on the shared
 *     `B` template (composed with `MAP` via `BitCom` when metadata is
 *     supplied, rather than reimplementing multi-protocol script layout).
 *     Plain on-chain data; nothing is owned or held as a UTXO.
 *
 * Locking is pluggable (an address or a per-vout resolver) and applies to
 * ordinal outputs — `'b'` outputs are OP_RETURN and provably
 * unspendable, so there is nothing to lock. MAP is whatever the caller
 * passes. Signing is deliberately NOT policy-enforced here: this builder
 * accepts any `aip` signer regardless of `writeMode` (it is the pure, "dumb"
 * primitive). It's `deployOrdfsDir` (the publishing action) that enforces the
 * real policy — SIGMA for an ordinal root, AIP for an all-B tree — since
 * SIGMA needs a spending input that only exists during transaction building.
 */

import {
	B,
	B_PREFIX,
	BitCom,
	Encoding,
	Inscription,
	MAP,
	MAP_PREFIX,
} from '@1sat/templates'
import type { Protocol } from '@1sat/templates'
import { type LockingScript, P2PKH, Script, Utils } from '@bsv/sdk'
import type { OneSatContext } from '../types'
import { appendMapSuffix } from '../utils/appendMapSuffix'
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
 * How an ord-fs directory publish is written on-chain.
 *
 * - `'mixed'` (default) — 0-sat B leaves and a 1-sat ordinal root.
 * - `'inscription'` — a 1-sat ord envelope per output. Ownable,
 *   transferable, and updatable; holds a UTXO on chain until explicitly
 *   spent. `locking` controls who can spend it.
 * - `'b'` — a 0-sat B protocol (bitcom `B://`) output per output. Plain
 *   on-chain data, not an ordinal: no UTXO is held, nothing is
 *   ownable/transferable, and `locking` is ignored — OP_RETURN outputs are
 *   provably unspendable.
 */
export type OrdfsDirWriteMode = 'mixed' | 'inscription' | 'b'

/**
 * An address applied to every output, or a resolver that returns the locking
 * script per vout. The resolver lets callers vary the lock per output without
 * exposing a raw private key here. Used by every ordinal output, including
 * the root of a `mixed` layout.
 */
export type OrdfsLocking =
	| { address: string }
	| { resolve: (vout: number) => LockingScript }

/**
 * Options for {@link buildOrdFsDirOutputs}.
 */
export interface BuildOrdFsDirOutputsOptions {
	/**
	 * Output layout. Defaults to `'mixed'` (B leaves, ordinal root).
	 */
	writeMode?: OrdfsDirWriteMode
	/**
	 * Locking applied to ordinal outputs, so the caller controls who can spend
	 * them. Required for `mixed` and `inscription`; ignored for `b`.
	 */
	locking?: OrdfsLocking
	/**
	 * MAP fields for the root manifest only, composed with the manifest's
	 * content via the shared `MAP`/`BitCom` templates. Written as given —
	 * nothing added or rewritten.
	 */
	map?: Record<string, string>
	/**
	 * AIP signer for the root manifest. Receives the manifest script (with any
	 * MAP suffix) and returns it with an AIP suffix. This builder does not
	 * tie `aip` to a particular `writeMode` — see the module doc comment for
	 * why that policy lives in the publishing action instead.
	 */
	aip?: (ctx: OneSatContext, manifestScript: Script) => Promise<Script>
}

/**
 * A single output in an ord-fs directory publish transaction.
 */
export interface OrdfsDirOutput {
	/** Hex-encoded locking script (inscription envelope or B protocol, plus any suffix). */
	lockingScriptHex: string
	/** Satoshi amount: 1 for ordinal outputs, 0 for B outputs. */
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
 * Slice a single-protocol BitCom-locked script (e.g. from `B.lock()`,
 * `MAP.set()`) down to its bare protocol descriptor — stripping the leading
 * OP_RETURN and protocol-prefix pushdata chunks — so it can be recomposed
 * with other protocols into one combined OP_RETURN via {@link BitCom}. This
 * reuses the same multi-protocol layout `BitCom.lock()` already implements,
 * rather than hand-assembling pipe-delimited OP_RETURN chunks again.
 */
function toProtocol(prefix: string, locked: LockingScript): Protocol {
	return {
		protocol: prefix,
		script: new Script(locked.chunks.slice(2)).toBinary(),
		pos: 0,
	}
}

/**
 * Build a single output's content script for the given write mode.
 *
 * `'inscription'` requires `locking` (there's a UTXO to protect); `'b'` never
 * touches `locking` (there's nothing to own).
 */
function buildLeafScript(
	writeMode: OrdfsDirWriteMode,
	content: Uint8Array,
	contentType: string,
	locking: OrdfsLocking | undefined,
	vout: number,
): Script {
	if (writeMode === 'b') {
		return new Script(B.lock(content, contentType, Encoding.Binary).chunks)
	}
	if (!locking) {
		throw new Error(
			"buildOrdFsDirOutputs: 'locking' is required for ordinal outputs — it controls who can spend the UTXO",
		)
	}
	const inscription = Inscription.create(content, contentType, {
		scriptPrefix: lockFor(locking, vout),
	})
	return new Script(inscription.lock().chunks)
}

/**
 * Build the root manifest's content script, with the optional MAP suffix
 * composed for the given write mode.
 *
 * `'inscription'`: MAP is appended as a scriptSuffix after the ord envelope
 * (the envelope itself carries no OP_RETURN, so MAP's own is the first and
 * only one). `'b'`: the manifest's B protocol output already contains an
 * OP_RETURN, so MAP must be recomposed into the *same* OP_RETURN via
 * {@link BitCom} — appending a second OP_RETURN-prefixed script would produce
 * a malformed BitCom multi-protocol layout.
 */
function buildManifestScript(
	writeMode: OrdfsDirWriteMode,
	manifestBytes: Uint8Array,
	contentType: string,
	locking: OrdfsLocking | undefined,
	vout: number,
	map?: Record<string, string>,
): Script {
	const hasMap = map != null && Object.keys(map).length > 0

	if (writeMode === 'b') {
		const protocols: Protocol[] = [
			toProtocol(B_PREFIX, B.lock(manifestBytes, contentType, Encoding.Binary)),
		]
		if (hasMap) {
			protocols.push(
				toProtocol(MAP_PREFIX, MAP.set(map as Record<string, string>)),
			)
		}
		return new Script(new BitCom(protocols).lock().chunks)
	}

	if (!locking) {
		throw new Error(
			"buildOrdFsDirOutputs: 'locking' is required for the ordinal root — it controls who can spend the UTXO",
		)
	}
	const manifestInscription = Inscription.create(manifestBytes, contentType, {
		scriptPrefix: lockFor(locking, vout),
	})
	return appendMapSuffix(
		new Script(manifestInscription.lock().chunks),
		hasMap ? map : undefined,
	)
}

/**
 * Build the outputs that publish an ord-fs/json directory.
 *
 * Layout (matching {@link buildOrdfsDirManifest}):
 *   [0..F-1]   one output per file, in `files` order
 *   [F..F+D-1] one output per subdirectory manifest
 *   [F+D]      the root manifest output (MAP + AIP suffix, if supplied)
 *
 * @param files - Files to publish, in the order their outputs are created.
 *   Paths use `/` for subdirectories (e.g. `"refs/api.md"`).
 * @param opts - Write mode, locking strategy (for ordinal outputs), plus
 *   optional MAP and AIP signer for the root manifest.
 * @param ctx - Forwarded to the AIP signer; may be omitted when none is given.
 * @returns The outputs, the root manifest's vout and script, and the tree.
 */
export async function buildOrdFsDirOutputs(
	files: OrdfsDirFile[],
	opts: BuildOrdFsDirOutputsOptions,
	ctx?: OneSatContext,
): Promise<BuildOrdFsDirOutputsResult> {
	const writeMode: OrdfsDirWriteMode = opts.writeMode ?? 'mixed'
	const leafWriteMode = writeMode === 'mixed' ? 'b' : writeMode
	const manifestWriteMode = writeMode === 'mixed' ? 'inscription' : writeMode
	const leafSatoshis = leafWriteMode === 'b' ? 0 : 1
	const manifestSatoshis = manifestWriteMode === 'b' ? 0 : 1

	const tree = buildOrdfsDirManifest(files)
	const outputs: OrdfsDirOutput[] = []

	// -------------------------------------------------------------------
	// 1. File outputs (vouts 0..F-1)
	// -------------------------------------------------------------------
	for (let i = 0; i < files.length; i++) {
		const file = files[i]
		const script = buildLeafScript(
			leafWriteMode,
			file.content,
			file.contentType,
			opts.locking,
			i,
		)
		outputs.push({
			lockingScriptHex: Utils.toHex(script.toBinary()),
			satoshis: leafSatoshis,
			description: `file: ${file.path}`,
			isManifest: false,
		})
	}

	// -------------------------------------------------------------------
	// 2. Subdirectory manifest outputs (vouts F..F+D-1)
	// -------------------------------------------------------------------
	for (const subdir of tree.subdirs) {
		const subdirBytes = new Uint8Array(
			Utils.toArray(JSON.stringify(subdir.manifest), 'utf8'),
		)
		const script = buildLeafScript(
			leafWriteMode,
			subdirBytes,
			tree.manifestContentType,
			opts.locking,
			subdir.vout,
		)
		outputs.push({
			lockingScriptHex: Utils.toHex(script.toBinary()),
			satoshis: leafSatoshis,
			description: `dir: ${subdir.path}/`,
			isManifest: false,
		})
	}

	// -------------------------------------------------------------------
	// 3. Root manifest output (last). MAP is composed into it; AIP is
	//    applied afterward, since it signs over the MAP data too.
	// -------------------------------------------------------------------
	const manifestBytes = new Uint8Array(
		Utils.toArray(JSON.stringify(tree.root), 'utf8'),
	)

	let manifestScript = buildManifestScript(
		manifestWriteMode,
		manifestBytes,
		tree.manifestContentType,
		opts.locking,
		tree.manifestVout,
		opts.map,
	)

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
		satoshis: manifestSatoshis,
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
