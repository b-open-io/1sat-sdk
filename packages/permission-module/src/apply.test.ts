import { describe, expect, test } from 'bun:test'
import {
	buildIntentLabel,
	OPNS_BASKET,
	OPNS_REGISTER_COUNTERPARTY,
	OPNS_REGISTER_SIG_PLACEHOLDER_LEN,
	opnsRegisterKeyId,
	P1SAT_INTENTS,
	P1SAT_PROTOCOL,
} from '@1sat/types'
import type {
	CreateActionArgs,
	CreateSignatureArgs,
	GetPublicKeyArgs,
	WalletInterface,
} from '@bsv/sdk'
import { LockingScript, PrivateKey, PushDrop, Utils } from '@bsv/sdk'
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

/** Complete opns.register lock with the signature field left zeroed. */
async function unsealedLock(
	wallet: WalletInterface,
	outpoint: string,
): Promise<string> {
	const { publicKey } = await wallet.getPublicKey({ identityKey: true })
	const script = await new PushDrop(wallet).lock(
		[
			Utils.toArray(publicKey, 'hex'),
			new Array(OPNS_REGISTER_SIG_PLACEHOLDER_LEN).fill(0),
		],
		P1SAT_PROTOCOL,
		opnsRegisterKeyId(outpoint),
		OPNS_REGISTER_COUNTERPARTY,
		true,
		false,
	)
	return script.toHex()
}

async function registerArgs(
	wallet: WalletInterface,
	outpoint = `${'aa'.repeat(32)}.0`,
): Promise<CreateActionArgs> {
	const lockingScript = await unsealedLock(wallet, outpoint)
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
				lockingScript,
				satoshis: 1,
				outputDescription: 'bind',
				basket: OPNS_BASKET,
				tags: ['name:alice', 'opns:published'],
			},
		],
	}
}

describe('applyCreateAction / opns.register', () => {
	test('replaces the zeroed signature in place (same outputs array ref)', async () => {
		const wallet = mockBaseWallet()
		const args = await registerArgs(wallet)
		const outputsRef = args.outputs!
		const out = outputsRef[0]
		const before = out.lockingScript

		await applyCreateAction(wallet, args, P1SAT_INTENTS.OPNS_REGISTER)

		expect(args.outputs).toBe(outputsRef)
		expect(out.lockingScript).not.toBe(before)

		const fields = PushDrop.decode(
			LockingScript.fromHex(out.lockingScript),
		).fields
		const signature = fields[fields.length - 1]
		expect(signature.some((b) => b !== 0)).toBe(true)
		// Placeholder was sized to the longest DER signature, so the sealed
		// script is never larger than what was estimated.
		expect(out.lockingScript.length).toBeLessThanOrEqual(before.length)
	})

	test('unknown intent fails closed', async () => {
		const wallet = mockBaseWallet()
		const args = await registerArgs(wallet)
		args.labels = [buildIntentLabel('nope.unknown')]
		await expect(applyCreateAction(wallet, args)).rejects.toThrow(
			/unknown intent/,
		)
	})

	test('validate-only intents leave lockingScript unchanged', async () => {
		const wallet = mockBaseWallet()
		const args = await registerArgs(wallet)
		args.labels = [buildIntentLabel(P1SAT_INTENTS.OPNS_DEREGISTER)]
		const before = args.outputs![0].lockingScript
		await applyCreateAction(wallet, args, P1SAT_INTENTS.OPNS_DEREGISTER)
		expect(args.outputs![0].lockingScript).toBe(before)
	})
})

describe('handleCreateActionRequest admin vs dApp', () => {
	test('admin applies without prompt', async () => {
		const wallet = mockBaseWallet()
		const args = await registerArgs(wallet)
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

		const args = await registerArgs(wallet)
		const before = args.outputs![0].lockingScript
		let promptSummary = ''
		const promptHandler: PromptHandler = async (req) => {
			// A host may hand this request to a renderer in another process — the
			// browser extension writes it through chrome.storage. Anything that
			// cannot be structured-cloned (a promise, a function) arrives as `{}`
			// and breaks the prompt, so the payload must survive a round trip.
			expect(() => structuredClone(req)).not.toThrow()
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
		const args = await registerArgs(wallet)
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
