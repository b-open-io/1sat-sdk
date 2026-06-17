import { describe, expect, it } from 'bun:test'
import { Utils } from '@bsv/sdk'
import { PrivateKey } from '@bsv/sdk'
import { buildOrdfsDirManifest } from '../src/ordfs/manifest'
import { buildPackageOutputs } from '../src/registry/package-tx'
import type { PackageFile, PackageMapMetadata } from '../src/registry/types'

describe('buildOrdfsDirManifest', () => {
	it('lays out a flat directory of root-level files', () => {
		const tree = buildOrdfsDirManifest([
			{ path: 'README.md' },
			{ path: 'index.ts' },
		])

		expect(tree.files).toEqual([
			{ path: 'README.md', vout: 0 },
			{ path: 'index.ts', vout: 1 },
		])
		expect(tree.subdirs).toEqual([])
		expect(tree.root).toEqual({ 'README.md': '_0', 'index.ts': '_1' })
		// Root manifest is the last output: 2 files + 0 subdirs => vout 2.
		expect(tree.manifestVout).toBe(2)
		expect(tree.manifestContentType).toBe('ord-fs/json')
	})

	it('throws on a duplicate root-level path (would orphan an output)', () => {
		expect(() =>
			buildOrdfsDirManifest([{ path: 'a.md' }, { path: 'a.md' }]),
		).toThrow(/path collision/)
	})

	it('throws when a root file collides with a subdirectory name', () => {
		expect(() =>
			buildOrdfsDirManifest([{ path: 'a' }, { path: 'a/b.md' }]),
		).toThrow(/path collision/)
	})

	it('throws on a duplicate nested path within a subdirectory', () => {
		expect(() =>
			buildOrdfsDirManifest([{ path: 'refs/api.md' }, { path: 'refs/api.md' }]),
		).toThrow(/path collision/)
	})

	it('builds a subdirectory manifest for nested files', () => {
		const tree = buildOrdfsDirManifest([
			{ path: 'SKILL.md' }, // vout 0
			{ path: 'refs/api.md' }, // vout 1
			{ path: 'refs/cli.md' }, // vout 2
		])

		expect(tree.files.map((f) => f.vout)).toEqual([0, 1, 2])

		// One subdirectory ("refs"), inscribed immediately after the files.
		expect(tree.subdirs).toHaveLength(1)
		const refs = tree.subdirs[0]
		expect(refs.path).toBe('refs')
		expect(refs.vout).toBe(3) // 3 files => first subdir at vout 3
		expect(refs.manifest).toEqual({ 'api.md': '_1', 'cli.md': '_2' })

		// Root references the root file directly and the subdir by its manifest.
		expect(tree.root).toEqual({ 'SKILL.md': '_0', refs: '_3' })

		// Root manifest is last: 3 files + 1 subdir => vout 4.
		expect(tree.manifestVout).toBe(4)
	})

	it('builds a manifest per level for deeply nested paths', () => {
		const tree = buildOrdfsDirManifest([
			{ path: 'docs/v1/api.md' }, // vout 0
			{ path: 'docs/v2/api.md' }, // vout 1
		])

		// One manifest per directory: docs, docs/v1, docs/v2 (DFS order),
		// inscribed after the 2 files; root last.
		expect(tree.subdirs.map((s) => [s.path, s.vout])).toEqual([
			['docs', 2],
			['docs/v1', 3],
			['docs/v2', 4],
		])
		// Keys are single-segment at every level — no slashes.
		expect(tree.subdirs[0].manifest).toEqual({ v1: '_3', v2: '_4' })
		expect(tree.subdirs[1].manifest).toEqual({ 'api.md': '_0' })
		expect(tree.subdirs[2].manifest).toEqual({ 'api.md': '_1' })
		expect(tree.root).toEqual({ docs: '_2' })
		expect(tree.manifestVout).toBe(5)
	})

	it('assigns subdirectory vouts in first-seen order', () => {
		const tree = buildOrdfsDirManifest([
			{ path: 'a/one.md' }, // vout 0 -> subdir "a"
			{ path: 'b/two.md' }, // vout 1 -> subdir "b"
			{ path: 'a/three.md' }, // vout 2 -> subdir "a"
		])

		// "a" seen first => vout 3, "b" => vout 4.
		expect(tree.subdirs.map((s) => [s.path, s.vout])).toEqual([
			['a', 3],
			['b', 4],
		])
		expect(tree.subdirs[0].manifest).toEqual({
			'one.md': '_0',
			'three.md': '_2',
		})
		expect(tree.subdirs[1].manifest).toEqual({ 'two.md': '_1' })
		expect(tree.root).toEqual({ a: '_3', b: '_4' })
		expect(tree.manifestVout).toBe(5)
	})
})

describe('buildPackageOutputs (refactor characterization)', () => {
	const key = PrivateKey.fromRandom()

	const files: PackageFile[] = [
		{
			path: 'SKILL.md',
			content: new Uint8Array(Utils.toArray('# Skill', 'utf8')),
			contentType: 'text/markdown',
		},
		{
			path: 'refs/api.md',
			content: new Uint8Array(Utils.toArray('# API', 'utf8')),
			contentType: 'text/markdown',
		},
	]

	const metadata: PackageMapMetadata = {
		app: 'test-app',
		type: 'registry:skill',
		name: 'test-skill',
		version: '1.0.0',
		description: 'A test skill',
	}

	it('produces the documented file/subdir/manifest output layout', async () => {
		const result = await buildPackageOutputs(files, metadata, key)

		// 2 files + 1 subdir + 1 manifest => 4 outputs, manifest last.
		expect(result.outputs).toHaveLength(4)
		expect(result.manifestVout).toBe(3)

		expect(result.outputs[0].description).toBe('file: SKILL.md')
		expect(result.outputs[0].isManifest).toBe(false)
		expect(result.outputs[1].description).toBe('file: refs/api.md')
		expect(result.outputs[2].description).toBe('dir: refs/')
		expect(result.outputs[3].description).toBe('manifest (ord-fs/json)')
		expect(result.outputs[3].isManifest).toBe(true)

		for (const out of result.outputs) {
			expect(out.satoshis).toBe(1)
			expect(out.lockingScriptHex.length).toBeGreaterThan(0)
		}
	})

	it('embeds the shared tree layout in the manifest output', async () => {
		const tree = buildOrdfsDirManifest(files)
		expect(tree.root).toEqual({ 'SKILL.md': '_0', refs: '_2' })
		expect(tree.subdirs[0].manifest).toEqual({ 'api.md': '_1' })

		const result = await buildPackageOutputs(files, metadata, key)
		// The manifest output index matches the tree's computed manifestVout.
		expect(result.manifestVout).toBe(tree.manifestVout)
	})
})
