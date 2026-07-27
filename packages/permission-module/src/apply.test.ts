import { describe, expect, test } from 'bun:test'
import {
	OPNS_BASKET,
	OPNS_REGISTER_LOCK_PLACEHOLDER_HEX,
	P1SAT_INTENTS,
	buildIntentLabel,
	opnsRegisterKeyId,
} from '@1sat/types'
import type {
	CreateActionArgs,
	CreateSignatureArgs,
	GetPublicKeyArgs,
	WalletInterface,
} from '@bsv/sdk'
import { PrivateKey } from '@bsv/sdk'
import { applyCreateAction } from './apply'
import { CommitmentCache } from './commitmentCache'
import { handleCreateActionRequest } from './handlers'
import type { PromptHandler } from './types'

function mockBaseWallet(): WalletInterface {
	const key = PrivateKey.fromRandom()
	const identity = key.toPublicKey().toString()
	const protocolKey = PrivateKey.fromRandom().toPublicKey().toString()

	return {
		async getPublicKey(args: GetPublicKeyArgs) {
			if (args.identityKey) return { publicKey: identity }
			return { publicKey: protocolKey }
		},
		async createSignature(_args: CreateSignatureArgs) {
			// 70-byte DER-ish stub — PushDrop only embeds the bytes
			const sig = new Array(70).fill(0x30)
			return { signature: sig }
		},
	} as unknown as WalletInterface
}

function registerArgs(outpoint = `${'aa'.repeat(32)}.0`): CreateActionArgs {
	return {
		description: 'Publish OpNS',
		labels: [
			buildIntentLabel(P1SAT_INTENTS.OPNS_REGISTER),
			'p 1sat input opns test-id',
		],
		inputs: [
			{
				outpoint,
				inputDescription: 'OpNS name',
				unlockingScriptLength: 108,
			},
		],
		outputs: [
			{
				lockingScript: OPNS_REGISTER_LOCK_PLACEHOLDER_HEX,
				satoshis: 1,
				outputDescription: 'bind',
				basket: OPNS_BASKET,
				tags: ['name:alice', 'opns:published'],
			},
		],
	}
}

describe('applyCreateAction / opns.register', () => {
	test('seals PushDrop in place (same outputs array ref)', async () => {
		const wallet = mockBaseWallet()
		const args = registerArgs()
		const outputsRef = args.outputs!
		const out = outputsRef[0]
		const before = out.lockingScript

		await applyCreateAction(wallet, args, P1SAT_INTENTS.OPNS_REGISTER)

		expect(args.outputs).toBe(outputsRef)
		expect(out.lockingScript).not.toBe(before)
		expect(out.lockingScript.length).toBeGreaterThan(before.length / 2)
		// PushDrop starts with locking pubkey push
		expect(out.lockingScript.length % 2).toBe(0)
	})

	test('unknown intent fails closed', async () => {
		const wallet = mockBaseWallet()
		const args = registerArgs()
		args.labels = [buildIntentLabel('nope.unknown')]
		await expect(applyCreateAction(wallet, args)).rejects.toThrow(
			/unknown intent/,
		)
	})

	test('validate-only intents leave lockingScript unchanged', async () => {
		const wallet = mockBaseWallet()
		const args = registerArgs()
		args.labels = [buildIntentLabel(P1SAT_INTENTS.OPNS_DEREGISTER)]
		const before = args.outputs![0].lockingScript
		await applyCreateAction(wallet, args, P1SAT_INTENTS.OPNS_DEREGISTER)
		expect(args.outputs![0].lockingScript).toBe(before)
	})
})

describe('handleCreateActionRequest admin vs dApp', () => {
	test('admin applies without prompt', async () => {
		const wallet = mockBaseWallet()
		const args = registerArgs()
		const before = args.outputs![0].lockingScript
		let prompted = false
		const promptHandler: PromptHandler = async () => {
			prompted = true
			return true
		}
		const deps = {
			wallet,
			promptHandler,
			cache: new CommitmentCache(60),
			adminOriginator: 'admin.yours.org',
		}

		const next = await handleCreateActionRequest(deps, args, 'admin.yours.org')
		expect(prompted).toBe(false)
		expect(next.outputs![0].lockingScript).not.toBe(before)
	})

	test('dApp prompts then applies on approve', async () => {
		const wallet = mockBaseWallet()
		// enrichIntent listOutputs will fail → empty inputs; still applies
		const listWallet = {
			...wallet,
			async listOutputs() {
				return { totalOutputs: 0, outputs: [] }
			},
		} as unknown as WalletInterface

		const args = registerArgs()
		const before = args.outputs![0].lockingScript
		let promptSummary = ''
		const promptHandler: PromptHandler = async (req) => {
			promptSummary = req.summary
			expect(req.intent.p1satIntent).toBe('opns.register')
			return true
		}
		const deps = {
			wallet: listWallet,
			promptHandler,
			cache: new CommitmentCache(60),
			adminOriginator: 'admin.yours.org',
		}

		const next = await handleCreateActionRequest(
			deps,
			args,
			'https://dapp.example',
		)
		expect(promptSummary.toLowerCase()).toContain('publish')
		expect(next.outputs![0].lockingScript).not.toBe(before)
	})

	test('dApp reject does not apply', async () => {
		const wallet = mockBaseWallet()
		const listWallet = {
			...wallet,
			async listOutputs() {
				return { totalOutputs: 0, outputs: [] }
			},
		} as unknown as WalletInterface
		const args = registerArgs()
		const before = args.outputs![0].lockingScript
		const deps = {
			wallet: listWallet,
			promptHandler: async () => false,
			cache: new CommitmentCache(60),
			adminOriginator: 'admin.yours.org',
		}

		await expect(
			handleCreateActionRequest(deps, args, 'https://dapp.example'),
		).rejects.toThrow(/rejected/)
		expect(args.outputs![0].lockingScript).toBe(before)
	})
})

describe('opnsRegisterKeyId binding', () => {
	test('key id derived from spent outpoint', () => {
		expect(opnsRegisterKeyId('abcd.1')).toBe('opns:abcd_1')
	})
})
