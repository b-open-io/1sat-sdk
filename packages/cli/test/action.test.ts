import { expect, test } from 'bun:test'

test.each([
	{
		actionName: 'cancelOwnedListings',
		errors: ['simulated incomplete cancellation'],
		exitCode: 1,
	},
	{ actionName: 'cancelOwnedListings', errors: [], exitCode: 0 },
	{
		actionName: 'anotherAction',
		errors: ['existing result semantics'],
		exitCode: 0,
	},
])(
	'generic $actionName result with $errors exits $exitCode and preserves JSON/cleanup',
	async ({ actionName, errors, exitCode }) => {
		const result = { cancelled: 1, txids: ['completed'], errors }
		const command = new URL('../src/commands/action.ts', import.meta.url)
			.pathname
		const keys = new URL('../src/keys.js', import.meta.url).pathname
		const context = new URL('../src/context.js', import.meta.url).pathname
		// An isolated process checks the real exit status without loading keys or opening a wallet.
		const script = `
		import { mock } from 'bun:test'
		mock.module('@1sat/actions', () => ({ actionRegistry: {
			get: () => ({ execute: async () => (${JSON.stringify(result)}) }),
		} }))
		mock.module(${JSON.stringify(keys)}, () => ({ loadKey: async () => ({}) }))
		mock.module(${JSON.stringify(context)}, () => ({ loadContext: async () => ({
			ctx: {}, destroy: async () => { console.error('context destroyed') },
		}) }))
		const { handleActionCommand } = await import(${JSON.stringify(command)})
		await handleActionCommand([${JSON.stringify(actionName)}, '{}'], { json: true, chain: 'test' })
	`
		const child = Bun.spawn([process.execPath, '--eval', script], {
			cwd: new URL('..', import.meta.url).pathname,
			stdout: 'pipe',
			stderr: 'pipe',
		})
		const [stdout, stderr, actualExitCode] = await Promise.all([
			new Response(child.stdout).text(),
			new Response(child.stderr).text(),
			child.exited,
		])
		expect(actualExitCode).toBe(exitCode)
		expect(JSON.parse(stdout)).toEqual(result)
		expect(stderr).toBe('context destroyed\n')
	},
)
