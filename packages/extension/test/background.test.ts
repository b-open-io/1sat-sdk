import { expect, test } from 'bun:test'

// Keep the browser module mock isolated from other workspace tests.
test.each([true, false])(
	'background dispatches listing methods to configured handlers (auto-approve: %s)',
	async (autoApprove) => {
		const background = new URL('../src/background.ts', import.meta.url).pathname
		const script = `
			import { mock } from 'bun:test'
			let listener
			const session = {}
			mock.module('webextension-polyfill', () => ({ default: {
				runtime: { onMessage: { addListener: fn => { listener = fn } } },
				storage: { session: {
					get: async () => session,
					set: async data => Object.assign(session, data),
				} },
				tabs: { onRemoved: { addListener() {} } },
			} }))
			const { createBackgroundHandler } = await import(${JSON.stringify(background)})
			const calls = []
			createBackgroundHandler({
				shouldAutoApprove: () => ${autoApprove},
				handlers: {
					createListing: async () => { calls.push('create'); return {} },
					cancelListing: async () => { calls.push('cancel'); return { txid: 'cancelled' } },
					purchaseListing: async () => { calls.push('purchase'); return { txid: 'purchased' } },
				},
			})
			const request = method => listener({ type: 'ONESAT_REQUEST', id: method, method, params: {} }, { url: 'https://example.com' })
			const create = await request('createListing')
			const cancel = await request('cancelListing')
			const purchase = await request('purchaseListing')
			console.log(JSON.stringify({ create, cancel, purchase, calls }))
		`
		const child = Bun.spawn([process.execPath, '--eval', script], {
			cwd: new URL('..', import.meta.url).pathname,
			stdout: 'pipe',
			stderr: 'pipe',
		})
		const [stdout, stderr, exitCode] = await Promise.all([
			new Response(child.stdout).text(),
			new Response(child.stderr).text(),
			child.exited,
		])
		expect(stderr).toBe('')
		expect(exitCode).toBe(0)
		const result = JSON.parse(stdout)
		expect(result.create).toMatchObject({
			type: 'ONESAT_RESPONSE',
			id: 'createListing',
			result: {},
		})
		expect(result.create.error).toBeUndefined()
		expect(result.calls).toEqual(['create', 'cancel', 'purchase'])
		expect(result.cancel.result).toEqual({ txid: 'cancelled' })
		expect(result.purchase.result).toEqual({ txid: 'purchased' })
	},
)
