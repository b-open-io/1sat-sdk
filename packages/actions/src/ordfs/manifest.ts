/**
 * ord-fs/json directory tree builder.
 *
 * Pure, key-agnostic logic that lays out a set of relative file paths into the
 * ord-fs directory structure used by ORDFS: a root manifest, one manifest per
 * subdirectory, and a mapping from each file to the transaction vout that will
 * carry its inscription.
 *
 * ORDFS manifests are JSON objects whose values are `_N` relative-vout
 * references — `_3` points at output index 3 in the same transaction. A
 * directory manifest therefore maps each child name (file or subdirectory) to
 * the vout of the inscription that holds that child's content (for files) or
 * that child's own manifest (for subdirectories).
 *
 * Vout layout produced here:
 *   [0..F-1]   one inscription per file, in caller order
 *   [F..F+D-1] one inscription per subdirectory manifest, in first-seen order
 *   [F+D]      the root manifest inscription (always last)
 *
 * This module computes the layout only. It does not build scripts, derive
 * keys, or create inscriptions — see `buildOrdFsDirOutputs` for that.
 */

import { MANIFEST_CONTENT_TYPE } from '../registry/constants'

/**
 * A single subdirectory manifest in the ord-fs tree.
 */
export interface OrdfsSubdirManifest {
	/**
	 * Directory name as it appears in the parent manifest (the first path
	 * segment, e.g. `"refs"` for files under `refs/`).
	 */
	name: string
	/**
	 * The subdirectory manifest object: maps each child file name (with the
	 * leading directory segment stripped) to its `_N` relative-vout reference.
	 * Nested children keep their remaining path (e.g. `"api.md"` or
	 * `"v1/api.md"`) so a single subdirectory manifest can flatten an entire
	 * branch.
	 */
	manifest: Record<string, string>
	/**
	 * The output index this subdirectory manifest's inscription occupies in
	 * the transaction. Referenced from the root manifest as `_<vout>`.
	 */
	vout: number
}

/**
 * The full ord-fs directory tree layout for a set of file paths.
 */
export interface OrdfsDirManifest {
	/**
	 * The root manifest object: maps each root-level file name and each
	 * top-level subdirectory name to its `_N` relative-vout reference. This is
	 * the object that becomes the tradeable directory inscription.
	 */
	root: Record<string, string>
	/**
	 * One entry per top-level subdirectory, in first-seen order. Each carries
	 * its own manifest object and the vout its inscription occupies.
	 */
	subdirs: OrdfsSubdirManifest[]
	/**
	 * Per-file output layout, parallel to the input `files` array (same order,
	 * same length). `vout` is the output index of that file's inscription.
	 */
	files: Array<{ path: string; vout: number }>
	/**
	 * The output index the root manifest inscription occupies — always the
	 * last output (`files.length + subdirs.length`).
	 */
	manifestVout: number
	/**
	 * Content type for every manifest inscription (root and subdirectories):
	 * `ord-fs/json`. Exposed so callers building outputs do not need to import
	 * the registry constant separately.
	 */
	manifestContentType: string
}

/**
 * Build the ord-fs/json directory tree for a set of relative file paths.
 *
 * Each input path may contain `/` to denote subdirectories. Root-level files
 * are referenced directly from the root manifest; files inside a subdirectory
 * are grouped under a single manifest inscription for that subdirectory so
 * ORDFS can traverse nested directories and unchanged branches can be
 * re-referenced in version updates.
 *
 * This is pure layout computation: no keys, scripts, or inscriptions are
 * involved. The returned `vout` indices assume the file inscriptions occupy
 * outputs `0..F-1` in the same order as `files`, followed by subdirectory
 * manifests, followed by the root manifest.
 *
 * @param files - Relative file paths in the order their inscriptions will be
 *   created. Paths use `/` as the directory separator (e.g. `"SKILL.md"`,
 *   `"refs/api.md"`). Order is significant: file `i` is assigned vout `i`.
 * @returns The directory tree layout — root manifest, subdirectory manifests,
 *   per-file vout assignments, the root manifest's vout, and the manifest
 *   content type.
 */
export function buildOrdfsDirManifest(
	files: Array<{ path: string }>,
): OrdfsDirManifest {
	// Per-file vout assignment: file i occupies output i.
	const fileLayout = files.map((file, i) => ({ path: file.path, vout: i }))

	// Group files by their top-level directory segment. Root-level files
	// (no `/`) are referenced directly from the root manifest; everything
	// else is grouped under its first path segment.
	const rootFiles: Array<{ name: string; vout: number }> = []
	const subdirEntries = new Map<string, Array<{ name: string; vout: number }>>()

	for (const file of fileLayout) {
		const parts = file.path.split('/')
		if (parts.length === 1) {
			rootFiles.push({ name: parts[0], vout: file.vout })
		} else {
			const dir = parts[0]
			const rest = parts.slice(1).join('/')
			if (!subdirEntries.has(dir)) subdirEntries.set(dir, [])
			subdirEntries.get(dir)?.push({ name: rest, vout: file.vout })
		}
	}

	// Assign each subdirectory manifest an output index, immediately after the
	// file inscriptions, in first-seen order. Build its manifest object mapping
	// child name → `_N` reference.
	const subdirs: OrdfsSubdirManifest[] = []
	let nextVout = files.length
	for (const [name, entries] of subdirEntries) {
		const manifest: Record<string, string> = {}
		for (const entry of entries) {
			manifest[entry.name] = `_${entry.vout}`
		}
		subdirs.push({ name, manifest, vout: nextVout })
		nextVout += 1
	}

	// The root manifest references root-level files and the per-subdirectory
	// manifests. Files first (preserving input order), then subdirectories.
	const root: Record<string, string> = {}
	for (const entry of rootFiles) {
		root[entry.name] = `_${entry.vout}`
	}
	for (const subdir of subdirs) {
		root[subdir.name] = `_${subdir.vout}`
	}

	// Root manifest is always the final output.
	const manifestVout = nextVout

	return {
		root,
		subdirs,
		files: fileLayout,
		manifestVout,
		manifestContentType: MANIFEST_CONTENT_TYPE,
	}
}
