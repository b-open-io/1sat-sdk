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
 *
 * Nesting is bounded by the ordfs server's own traversal limit: 1sat-stack's
 * `resolveDirectoryPath` (pkg/ordfs/routes.go) recurses into a child manifest
 * one path segment at a time and rejects requests past `maxDirectoryDepth`
 * (8). {@link MAX_ORDFS_DIRECTORY_DEPTH} mirrors that limit so a too-deep
 * tree fails here, at build time, instead of producing a manifest tree the
 * server will refuse to resolve.
 */

import { MANIFEST_CONTENT_TYPE } from '../registry/constants'

/**
 * Maximum number of directory levels a file path may nest under, mirroring
 * 1sat-stack's `maxDirectoryDepth` (pkg/ordfs/routes.go). A path with more
 * directory segments than this would require more manifest hops than the
 * ordfs server's `resolveDirectoryPath` will traverse.
 */
export const MAX_ORDFS_DIRECTORY_DEPTH = 8

/**
 * A subdirectory manifest in the ord-fs tree — one per directory at any depth.
 */
export interface OrdfsSubdirManifest {
	/**
	 * Full directory path from the root (e.g. `"refs"` or `"refs/v1"`). The
	 * parent manifest references this directory by its last segment.
	 */
	path: string
	/**
	 * The manifest object: maps each child's single-segment name to its `_N`
	 * relative-vout reference — a file's inscription vout, or a nested
	 * subdirectory manifest's vout. Keys never contain `/`; each directory level
	 * is its own manifest, matching how the ordfs server resolves a path one
	 * segment at a time.
	 */
	manifest: Record<string, string>
	/**
	 * The output index this subdirectory manifest's inscription occupies in
	 * the transaction. Referenced from the parent manifest as `_<vout>`.
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
	 * One entry per subdirectory at any depth, each with its own manifest and
	 * vout. A nested directory `a/b` produces two entries (`a` and `a/b`), with
	 * `a`'s manifest pointing at `a/b`'s vout.
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
 * Each input path may contain `/` to denote subdirectories. Every directory
 * level — root and each nested directory — gets its own manifest, and a parent
 * references a child directory by the child's single-segment name. This matches
 * how the ordfs server resolves a path: one segment at a time, recursing into a
 * child manifest when the segment points at another `ord-fs/json` inscription.
 *
 * Pure layout computation — no keys, scripts, or inscriptions. The returned
 * `vout` indices assume file inscriptions occupy outputs `0..F-1` in `files`
 * order, then the subdirectory manifests, then the root manifest last.
 *
 * @param files - Relative file paths in the order their inscriptions will be
 *   created. Paths use `/` as the directory separator (e.g. `"SKILL.md"`,
 *   `"refs/api.md"`). Order is significant: file `i` is assigned vout `i`.
 * @returns The directory tree layout — root manifest, the per-directory
 *   subdirectory manifests, per-file vout assignments, the root manifest's
 *   vout, and the manifest content type.
 */
export function buildOrdfsDirManifest(
	files: Array<{ path: string }>,
): OrdfsDirManifest {
	const fileLayout = files.map((file, i) => ({ path: file.path, vout: i }))

	// A directory node: each child name maps to a file's vout (number) or a
	// nested directory node. Built by walking each path segment by segment.
	type DirNode = Map<string, number | DirNode>
	const rootNode: DirNode = new Map()

	const collide = (key: string, scope: string): never => {
		throw new Error(
			`ord-fs directory path collision: "${key}" conflicts with an existing entry in ${scope}`,
		)
	}

	for (const { path, vout } of fileLayout) {
		const parts = path.split('/')
		const depth = parts.length - 1 // directory levels above this file
		if (depth >= MAX_ORDFS_DIRECTORY_DEPTH) {
			throw new Error(
				`ord-fs directory path too deep: "${path}" nests ${depth} directory levels; the ordfs server resolves at most ${MAX_ORDFS_DIRECTORY_DEPTH} (see 1sat-stack pkg/ordfs/routes.go maxDirectoryDepth)`,
			)
		}
		let node = rootNode
		let walked = ''
		for (let i = 0; i < parts.length - 1; i++) {
			const seg = parts[i]
			const existing = node.get(seg)
			if (existing === undefined) {
				const child: DirNode = new Map()
				node.set(seg, child)
				node = child
			} else if (existing instanceof Map) {
				node = existing
			} else {
				collide(seg, walked ? `directory "${walked}/"` : 'the root directory')
			}
			walked = walked ? `${walked}/${seg}` : seg
		}
		const name = parts[parts.length - 1]
		if (node.has(name)) {
			collide(name, walked ? `directory "${walked}/"` : 'the root directory')
		}
		node.set(name, vout)
	}

	// Assign each subdirectory manifest a vout after the file inscriptions, in
	// depth-first order; the root manifest is always last.
	const dirPaths: Array<{ path: string; node: DirNode }> = []
	const collect = (node: DirNode, path: string): void => {
		for (const [name, child] of node) {
			if (child instanceof Map) {
				const childPath = path ? `${path}/${name}` : name
				dirPaths.push({ path: childPath, node: child })
				collect(child, childPath)
			}
		}
	}
	collect(rootNode, '')

	const voutByPath = new Map<string, number>()
	let nextVout = files.length
	for (const { path } of dirPaths) voutByPath.set(path, nextVout++)
	const manifestVout = nextVout // root manifest last

	// Build a manifest object: file children → their vout, directory children →
	// the child manifest's vout. Keys stay single-segment.
	const manifestFor = (node: DirNode, path: string): Record<string, string> => {
		const manifest: Record<string, string> = {}
		for (const [name, child] of node) {
			const vout =
				child instanceof Map
					? (voutByPath.get(path ? `${path}/${name}` : name) as number)
					: child
			manifest[name] = `_${vout}`
		}
		return manifest
	}

	const subdirs: OrdfsSubdirManifest[] = dirPaths.map(({ path, node }) => ({
		path,
		manifest: manifestFor(node, path),
		vout: voutByPath.get(path) as number,
	}))

	return {
		root: manifestFor(rootNode, ''),
		subdirs,
		files: fileLayout,
		manifestVout,
		manifestContentType: MANIFEST_CONTENT_TYPE,
	}
}
