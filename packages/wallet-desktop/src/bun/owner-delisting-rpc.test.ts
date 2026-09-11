import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { OPNS_BASKET, ORDINALS_BASKET } from '@1sat/types'
import type { WalletInterface } from '@bsv/sdk'
import ts from 'typescript'
import {
	guardListingWallet,
	serializeListingOperation,
} from './owner-delisting.js'

// Exercise real RPC/lifecycle function bodies without loading Electrobun or wallets.
function sourceFunction(
	file: string,
	name: string,
	bindings: Record<string, unknown>,
	scope?: string,
) {
	const source = ts.createSourceFile(
		file,
		readFileSync(new URL(file, import.meta.url), 'utf8'),
		ts.ScriptTarget.Latest,
		true,
		file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
	)
	let code: string | undefined
	function visit(node: ts.Node) {
		if (ts.isPropertyAssignment(node) && node.name.getText(source) === name)
			code = node.initializer.getText(source)
		if (
			ts.isVariableDeclaration(node) &&
			node.name.getText(source) === name &&
			node.initializer &&
			ts.isCallExpression(node.initializer)
		)
			code = node.initializer.arguments[0].getText(source)
		if (ts.isFunctionDeclaration(node) && node.name?.text === name)
			code = node.getText(source).replace(/^export /, '')
		ts.forEachChild(node, visit)
	}
	let root: ts.Node = source
	if (scope) {
		function findScope(node: ts.Node) {
			if (ts.isFunctionDeclaration(node) && node.name?.text === scope)
				root = node
			ts.forEachChild(node, findScope)
		}
		findScope(source)
		if (root === source) throw new Error(`Missing scope ${scope}`)
	}
	visit(root)
	if (!code) throw new Error(`Missing function ${name}`)
	const compiled = ts.transpileModule(
		`(${code.replace("await import('@1sat/actions')", 'actions')})`,
		{ compilerOptions: { target: ts.ScriptTarget.ES2022 } },
	).outputText
	return runInNewContext(compiled, { ...bindings, AbortController })
}

function rpcFixture(
	options: {
		listing?: { txid?: string; error?: string }
		funding?: { txid?: string; error?: string }
		afterListing?: () => void
	} = {},
) {
	let walletCalls = 0
	const wallet = {
		createAction: async () => {
			walletCalls++
			return {}
		},
	} as unknown as WalletInterface
	const original = { wallet, services: {} }
	let current = original
	const observed = { scans: 0, listing: 0, funding: 0 }
	const snapshot = {
		listings: [
			{ outpoint: 'fresh-listing.0', satoshis: 1, lockingScript: 'listing' },
		],
		funding: [
			{ outpoint: 'fresh-funding.0', satoshis: 1000, lockingScript: 'funding' },
		],
	}
	const bindings = {
		requireWallet: () => current,
		guardListingWallet,
		serializeListingOperation,
		createContext: (captured: WalletInterface) => ({ wallet: captured }),
		PrivateKey: {
			fromWif: () => ({
				toPublicKey: () => ({ toAddress: () => 'fixture-address' }),
			}),
		},
		scanSweepAssets: async () => {
			observed.scans++
			return snapshot
		},
		sweepOrdinals: {
			execute: async (
				ctx: { wallet: WalletInterface },
				input: { inputs: unknown[] },
			) => {
				observed.listing++
				expect(input.inputs).toEqual(snapshot.listings)
				await ctx.wallet.createAction({ description: 'offline fixture' })
				options.afterListing?.()
				return options.listing ?? { txid: 'listing-receipt' }
			},
		},
		sweepBsv: {
			execute: async (
				ctx: { wallet: WalletInterface },
				input: { inputs: unknown[]; keys: unknown[] },
			) => {
				observed.funding++
				expect(input.inputs).toEqual(snapshot.funding)
				expect(input.keys).toHaveLength(1)
				await ctx.wallet.createAction({ description: 'offline fixture' })
				return options.funding ?? { txid: 'funding-receipt' }
			},
		},
	}
	return {
		handler: sourceFunction('./rpc-handlers.ts', 'sweepBsv', bindings),
		observed,
		walletCalls: () => walletCalls,
		switchWallet: () => {
			current = { wallet: {} as WalletInterface, services: {} }
		},
	}
}

describe('desktop delisting execution boundaries', () => {
	test('actual sweep RPC refreshes discovery and uses native cancellation before funding', async () => {
		const f = rpcFixture()
		const result = await f.handler({
			wif: 'fixture',
			assets: { funding: [{ outpoint: 'stale' }], listings: [] },
		})
		expect(f.observed).toEqual({ scans: 1, listing: 1, funding: 1 })
		expect(result.txids).toEqual(['listing-receipt', 'funding-receipt'])
	})
	test('failed cancellation and missing cancellation txid both block funding', async () => {
		for (const listing of [
			{ error: 'retry cancellation' },
			{},
			{ txid: '  ' },
		]) {
			const f = rpcFixture({ listing })
			const result = await f.handler({ wif: 'fixture' })
			expect(result.error).toBeTruthy()
			expect(f.observed.funding).toBe(0)
		}
	})
	test('funding failure retains the completed listing receipt', async () => {
		const f = rpcFixture({ funding: { error: 'funding unavailable' } })
		const result = await f.handler({ wif: 'fixture' })
		expect(result.error).toBe('funding unavailable')
		expect(result.txids).toEqual(['listing-receipt'])
	})
	test('account change after accepted cancellation stops funding and retains its receipt', async () => {
		const f = rpcFixture({ afterListing: () => f.switchWallet() })
		const result = await f.handler({ wif: 'fixture' })
		expect(result.error).toContain('Wallet changed')
		expect(result.txids).toEqual(['listing-receipt'])
		expect(f.observed.funding).toBe(0)
		expect(f.walletCalls()).toBe(1)
	})
	test('actual manual cancellation RPC routes OpNS and ordinals to their native action', async () => {
		for (const basket of [ORDINALS_BASKET, OPNS_BASKET]) {
			const wallet = {} as WalletInterface
			const calls: string[] = []
			const handler = sourceFunction('./rpc-handlers.ts', 'cancelListing', {
				requireWallet: () => ({ wallet }),
				guardListingWallet,
				serializeListingOperation,
				createContext: (captured: WalletInterface) => ({ wallet: captured }),
				findOwnedOrdinal: async () => ({
					basket,
					output: { tags: ['ordlock', 'id:asset'] },
				}),
				readAssetIdTag: () => 'asset',
				OPNS_BASKET,
				cancelOpnsListing: {
					execute: async (_ctx: unknown, input: unknown) => {
						expect(input).toEqual({ id: 'asset' })
						calls.push('opns')
						return { txid: 'receipt' }
					},
				},
				cancelOrdinalListing: {
					execute: async (_ctx: unknown, input: unknown) => {
						expect(input).toEqual({ id: 'asset' })
						calls.push('1sat')
						return { txid: 'receipt' }
					},
				},
			})
			expect((await handler({ outpoint: 'fixture.0' })).txid).toBe('receipt')
			expect(calls).toEqual([basket])
		}
	})
	test('native wallet adapter rejects the next operation after disposal', async () => {
		const controller = new AbortController()
		let calls = 0
		const wallet = {
			getPublicKey() {
				expect(this).toBe(wallet)
				calls++
				return { publicKey: 'fixture' }
			},
		} as unknown as WalletInterface
		const bound = guardListingWallet(wallet, () =>
			controller.signal.throwIfAborted(),
		)
		await bound.getPublicKey({ identityKey: true })
		controller.abort()
		expect(() => bound.getPublicKey({ identityKey: true })).toThrow()
		expect(calls).toBe(1)
	})
	test('shared queue serializes auto/manual cancellation and permits retry after failure', async () => {
		const wallet = {} as WalletInterface
		let release!: () => void
		const held = new Promise<void>((resolve) => {
			release = resolve
		})
		const calls: string[] = []
		const first = serializeListingOperation(wallet, async () => {
			calls.push('auto')
			await held
			throw new Error('retry')
		})
		const second = serializeListingOperation(wallet, async () => {
			calls.push('manual')
			return 'receipt'
		})
		await Promise.resolve()
		await Promise.resolve()
		expect(calls).toEqual(['auto'])
		release()
		await expect(first).rejects.toThrow('retry')
		expect(await second).toBe('receipt')
		expect(calls).toEqual(['auto', 'manual'])
	})
	test('actual lock handler aborts and removes account before asynchronous destruction', async () => {
		const controller = new AbortController()
		const wallets = new Map<string, unknown>()
		wallets.set('account', {
			cancelController: controller,
			callbacks: {},
			wallet: {
				destroy: async () => {
					expect(controller.signal.aborted).toBe(true)
					expect(wallets.has('account')).toBe(false)
				},
			},
		})
		const lock = sourceFunction('./wallet-manager.ts', 'lockAccount', {
			wallets,
		})
		await lock('account')
	})
	test('actual auto-on-load trigger coalesces overlap, passes signal and stops after lock', async () => {
		let release!: () => void
		const held = new Promise<void>((resolve) => {
			release = resolve
		})
		let executions = 0
		const events: unknown[] = []
		const instance = {
			wallet: { wallet: {} as WalletInterface, services: {} },
			callbacks: { onSyncEvent: (event: unknown) => events.push(event) },
			cancelController: undefined as AbortController | undefined,
		}
		const auto = sourceFunction('./wallet-manager.ts', 'cancelListedOnLoad', {
			guardListingWallet,
			serializeListingOperation,
			actions: {
				createContext: (wallet: WalletInterface) => ({ wallet }),
				cancelOwnedListings: {
					execute: async (_ctx: unknown, input: { signal: AbortSignal }) => {
						executions++
						expect(instance.cancelController?.signal).toBe(input.signal)
						await held
						return { cancelled: 1, errors: [], txids: ['receipt'] }
					},
				},
			},
		})
		const first = auto(instance)
		await auto(instance)
		await Promise.resolve()
		expect(executions).toBe(1)
		instance.cancelController?.abort()
		release()
		await first
		expect(events).toEqual([])
		expect(instance.cancelController).toBeUndefined()
	})
})

test('Settings sweep callback retains partial receipts, rejects missing txid and can retry', async () => {
	let result: { txid?: string; txids?: string[]; error?: string } = {
		txids: ['listing-receipt'],
		error: 'Funding failed',
	}
	let stored: typeof result | null = null
	let step = ''
	let successes = 0
	const handleSweep = sourceFunction(
		'../mainview/components/blocks/sweep-wallet/use-sweep-wallet.ts',
		'handleSweep',
		{
			wifInput: 'offline-fixture',
			WIF_PATTERN: { test: () => true },
			scanResult: {},
			onSweep: async () => result,
			setStep: (value: string) => {
				step = value
			},
			setError: () => {},
			setSweepResult: (update: (previous: typeof stored) => typeof stored) => {
				stored = update(stored)
			},
			onError: () => {},
			onSuccess: () => {
				successes++
			},
		},
	)
	await handleSweep()
	expect(step).toBe('error')
	expect((stored as typeof result | null)?.txids).toEqual(['listing-receipt'])
	result = { txid: '  ', txids: [' ', ' listing-receipt '] }
	await handleSweep()
	expect(step).toBe('error')
	expect(successes).toBe(0)
	result = { txid: 'funding-receipt' }
	await handleSweep()
	expect(step).toBe('done')
	expect((stored as typeof result | null)?.txids).toEqual([
		'listing-receipt',
		'funding-receipt',
	])
	expect(successes).toBe(1)
})

test('unchecked BSV selection passes through both UI callbacks and cancels only listings', async () => {
	const f = rpcFixture()
	let step = 0
	const sweepView = sourceFunction(
		'../mainview/views/sweep/index.tsx',
		'handleSweep',
		{
			pendingWif: 'fixture',
			scanResult: {},
			rpc: {
				request: {
					sweepBsv: async (input: { includeFunding: boolean }) => {
						expect(input.includeFunding).toBe(false)
						return f.handler(input)
					},
				},
			},
			setReceipts: () => {},
			setSweepTxid: () => {},
			setStep: (value: number) => {
				step = value
			},
		},
		'SweepView',
	)
	const sweepSelection = sourceFunction(
		'../mainview/views/sweep/index.tsx',
		'handleSweep',
		{
			sweepBsv: false,
			onSweep: sweepView,
			setError: (error: string) => {
				expect(error).toBe('')
			},
			setSweeping: () => {},
		},
		'StepResults',
	)
	await sweepSelection()
	expect(f.observed).toEqual({ scans: 1, listing: 1, funding: 0 })
	expect(step).toBe(4)
})

test('missing funding txid cannot complete a sweep or erase cancellation receipts', async () => {
	const f = rpcFixture({ funding: { txid: '  ' } })
	const result = await f.handler({ wif: 'fixture' })
	expect(result.error).toBeTruthy()
	expect(result.txids).toEqual(['listing-receipt'])
})

test('OpNS inventory reads native name metadata when its name tag is absent', async () => {
	const outputs = [
		{
			outpoint: 'a.0',
			tags: ['ordlock'],
			customInstructions: JSON.stringify({ name: 'alice' }),
		},
		{
			outpoint: 'b.0',
			tags: ['name:preferred'],
			customInstructions: JSON.stringify({ name: 'fallback' }),
		},
		{ outpoint: 'c.0', tags: ['ordlock'], customInstructions: '{' },
	]
	const handler = sourceFunction('./rpc-handlers.ts', 'getOpnsNames', {
		requireWallet: () => ({ wallet: {} }),
		createContext: () => ({}),
		OPNS_BASKET,
		listOwnedOutputs: async () => outputs,
	})
	expect(
		(await handler()).names.map((name: { name: string }) => name.name),
	).toEqual(['alice', 'preferred', ''])
})
