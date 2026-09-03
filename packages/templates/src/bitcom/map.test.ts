import { describe, expect, it } from 'bun:test'
import { Script, Utils } from '@bsv/sdk'
import MAP, { MAP_PREFIX, MAPCommand } from './map.js'

const { toArray } = Utils

/**
 * Reads the pushes of a MAP output back out as UTF-8 strings, starting at the
 * protocol prefix. Lets a test assert on the exact script layout rather than
 * only on what decode() chooses to surface.
 *
 * Note that re-parsing the hex would not work here: `Script.fromHex` folds
 * everything after OP_RETURN into a single data chunk, so the pushes are read
 * off the built script instead.
 */
const pushes = (script: Script): string[] =>
	script.chunks
		.filter((chunk) => chunk.data != null)
		.map((chunk) => Utils.toUTF8(chunk.data as number[]))

describe('MAP Protocol', () => {
	describe('SET', () => {
		it('round-trips key/value pairs', () => {
			const script = MAP.set({ app: 'testapp', type: 'post' })
			const decoded = MAP.decode(script)

			expect(decoded).not.toBeNull()
			expect(decoded?.cmd).toBe(MAPCommand.SET)
			expect(decoded?.data).toEqual({ app: 'testapp', type: 'post' })
		})

		it('writes CMD KEY VALUE pairs after the protocol prefix', () => {
			const script = MAP.set({ app: 'testapp' })
			expect(pushes(script)).toEqual([MAP_PREFIX, 'SET', 'app', 'testapp'])
		})

		it('decodes a script rebuilt from raw binary', () => {
			const script = MAP.set({ app: 'testapp', type: 'post' })
			const decoded = MAP.decode(toArray(script.toHex(), 'hex'))

			expect(decoded?.cmd).toBe(MAPCommand.SET)
			expect(decoded?.data.type).toBe('post')
		})

		it('app() sets app and type together', () => {
			const decoded = MAP.decode(MAP.app('testapp', 'post', { context: 'tx' }))

			expect(decoded?.cmd).toBe(MAPCommand.SET)
			expect(decoded?.data).toEqual({
				app: 'testapp',
				type: 'post',
				context: 'tx',
			})
		})
	})

	describe('ADD', () => {
		it('round-trips list values into adds', () => {
			const script = MAP.add('tags', ['bitcoin', 'ordinals', 'map'])
			const decoded = MAP.decode(script)

			expect(decoded?.cmd).toBe(MAPCommand.ADD)
			expect(decoded?.adds).toEqual(['bitcoin', 'ordinals', 'map'])
			expect(decoded?.data.tags).toBe('bitcoin ordinals map')
		})

		it('names the key first, then one push per value', () => {
			const script = MAP.add('tags', ['bitcoin', 'ordinals'])
			expect(pushes(script)).toEqual([
				MAP_PREFIX,
				'ADD',
				'tags',
				'bitcoin',
				'ordinals',
			])
		})

		it('keeps a single value as a one-element list', () => {
			const decoded = MAP.decode(MAP.add('tags', ['bitcoin']))

			expect(decoded?.adds).toEqual(['bitcoin'])
		})

		it('does not populate deletes', () => {
			const decoded = MAP.decode(MAP.add('tags', ['bitcoin']))

			expect(decoded?.deletes).toBeUndefined()
		})
	})

	describe('REMOVE', () => {
		it('clears every key it names', () => {
			const script = MAP.remove(['app', 'type', 'context'])
			const decoded = MAP.decode(script)

			expect(decoded?.cmd).toBe(MAPCommand.REMOVE)
			expect(decoded?.data).toEqual({ app: '', type: '', context: '' })
		})

		it('writes keys only, with no value pushes', () => {
			const script = MAP.remove(['app', 'type'])
			expect(pushes(script)).toEqual([MAP_PREFIX, 'REMOVE', 'app', 'type'])
		})

		it('does not populate adds or deletes', () => {
			const decoded = MAP.decode(MAP.remove(['app']))

			expect(decoded?.adds).toBeUndefined()
			expect(decoded?.deletes).toBeUndefined()
		})
	})

	describe('DELETE', () => {
		it('round-trips struck values into deletes', () => {
			const script = MAP.delete('tags', ['ordinals', 'map'])
			const decoded = MAP.decode(script)

			expect(decoded?.cmd).toBe(MAPCommand.DELETE)
			expect(decoded?.deletes).toEqual(['ordinals', 'map'])
		})

		it('names the list key first so values are scoped to that key', () => {
			const script = MAP.delete('tags', ['ordinals', 'map'])

			expect(pushes(script)).toEqual([
				MAP_PREFIX,
				'DELETE',
				'tags',
				'ordinals',
				'map',
			])
			expect(MAP.decode(script)?.data).toEqual({ tags: 'ordinals map' })
		})

		it('does not populate adds', () => {
			const decoded = MAP.decode(MAP.delete('tags', ['ordinals']))

			expect(decoded?.adds).toBeUndefined()
		})
	})

	describe('command vocabulary', () => {
		it('exposes exactly the six spec commands', () => {
			expect(Object.values(MAPCommand)).toEqual([
				'SET',
				'REMOVE',
				'ADD',
				'DELETE',
				'SELECT',
				'CLEAR',
			])
		})

		it('has no DEL command', () => {
			expect(
				(MAPCommand as Record<string, string | undefined>).DEL,
			).toBeUndefined()
		})
	})

	describe('decode', () => {
		it('returns null for a script with no OP_RETURN', () => {
			expect(MAP.decode(Script.fromASM('OP_1 OP_2'))).toBeNull()
		})

		it('returns null when the output carries no MAP protocol', () => {
			const notMap = Script.fromASM(
				`OP_RETURN ${Utils.toHex(toArray('19HxigV4QyBv3tHpQVcUEQyq1pzZVdoAut'))} ${Utils.toHex(toArray('hello'))}`,
			)
			expect(MAP.decode(notMap)).toBeNull()
		})
	})
})
