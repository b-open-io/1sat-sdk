import type { WalletInterface } from '@bsv/sdk'
import { describe, expect, it, mock } from 'bun:test'
import { handleCWIRequest } from '../../src/cwi/receiver'
import { CWIEventName } from '../../src/cwi/types'

const stubWallet = (
	overrides: Partial<WalletInterface> = {},
): WalletInterface =>
	({
		getVersion: mock(async () => ({ version: '1.0.0' })),
		getNetwork: mock(async () => ({ network: 'mainnet' })),
		createSignature: mock(async () => ({ signature: new Uint8Array() })),
		...overrides,
	}) as unknown as WalletInterface

describe('handleCWIRequest', () => {
	it('dispatches a valid action and returns ok', async () => {
		const wallet = stubWallet()
		const res = await handleCWIRequest(wallet, {
			action: CWIEventName.GET_VERSION,
			params: {},
		})
		expect(res).toEqual({ ok: true, data: { version: '1.0.0' } })
	})

	it('rejects an unknown action with a structured error', async () => {
		const wallet = stubWallet()
		const res = await handleCWIRequest(wallet, {
			action: 'MASTER_BACKUP' as unknown as CWIEventName,
			params: {},
		})
		expect(res.ok).toBe(false)
		if (res.ok) throw new Error('expected error')
		expect(res.error.code).toBe('UNKNOWN_ACTION')
	})

	it('catches wallet throws and returns structured error', async () => {
		const wallet = stubWallet({
			getVersion: mock(async () => {
				throw new Error('boom')
			}),
		})
		const res = await handleCWIRequest(wallet, {
			action: CWIEventName.GET_VERSION,
			params: {},
		})
		expect(res.ok).toBe(false)
		if (res.ok) throw new Error('expected error')
		expect(res.error.message).toBe('boom')
	})

	it('preserves correlation id on both success and error paths', async () => {
		const wallet = stubWallet()
		const ok = await handleCWIRequest(wallet, {
			action: CWIEventName.GET_VERSION,
			params: {},
			id: 'req-1',
		})
		expect(ok.id).toBe('req-1')

		const err = await handleCWIRequest(wallet, {
			action: 'nope' as CWIEventName,
			params: {},
			id: 'req-2',
		})
		expect(err.id).toBe('req-2')
	})

	it('forwards originator as second argument to the wallet method', async () => {
		const spy = mock(async () => ({ version: '1.0.0' }))
		const wallet = stubWallet({
			getVersion: spy as unknown as WalletInterface['getVersion'],
		})
		await handleCWIRequest(wallet, {
			action: CWIEventName.GET_VERSION,
			params: { a: 1 },
			originator: 'dapp.example.com',
		})
		expect(spy).toHaveBeenCalledWith({ a: 1 }, 'dapp.example.com')
	})
})
