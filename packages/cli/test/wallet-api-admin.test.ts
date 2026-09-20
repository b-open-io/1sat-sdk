import { describe, expect, test } from 'bun:test'
import { InMemoryPermissionStore } from '@1sat/wallet'
import type { WalletInterface } from '@bsv/sdk'
import { Utils } from '@bsv/sdk'
import { CLI_ADMIN_ORIGINATOR, adminWallet } from '../src/wallet-api/admin'

/**
 * Reversible stand-in for the metadata key. The 0x01 marker stands in for
 * the real cipher's integrity check: decrypting something that was never
 * encrypted throws, which is what makes the manager pass legacy plaintext
 * through untouched.
 */
const MARKER = 0x01
const scramble = (bytes: number[]): number[] => bytes.map((b) => b ^ 0x5a)

function encrypted(value: string): string {
	return Utils.toBase64([MARKER, ...scramble(Utils.toArray(value, 'utf8'))])
}

function mockWallet() {
	const originators: Array<string | undefined> = []
	const created: Array<Record<string, unknown>> = []
	const wallet = {
		async decrypt(args: { ciphertext: number[] }) {
			if (args.ciphertext[0] !== MARKER) throw new Error('not ciphertext')
			return { plaintext: scramble(args.ciphertext.slice(1)) }
		},
		async encrypt(args: { plaintext: number[] }) {
			return { ciphertext: [MARKER, ...scramble(args.plaintext)] }
		},
		async listActions(_args: unknown, originator?: string) {
			originators.push(originator)
			return {
				totalActions: 1,
				actions: [
					{
						txid: 'ab'.repeat(32),
						satoshis: 1,
						status: 'completed',
						isOutgoing: true,
						description: encrypted('push refs/heads/main'),
						// A value written before metadata encryption was on.
						labels: ['gib'],
						outputs: [
							{
								outputIndex: 0,
								satoshis: 1,
								outputDescription: 'plain and unencrypted',
							},
						],
					},
				],
			}
		},
		async listOutputs(_args: unknown, originator?: string) {
			originators.push(originator)
			return {
				totalOutputs: 1,
				outputs: [
					{
						outpoint: `${'ab'.repeat(32)}.0`,
						satoshis: 1,
						lockingScript: '',
						spendable: true,
						customInstructions: encrypted('{"id":"1"}'),
					},
				],
			}
		},
		async createAction(args: Record<string, unknown>, originator?: string) {
			originators.push(originator)
			created.push(args)
			return { txid: 'ab'.repeat(32), tx: [], noSendChange: [] }
		},
	} as unknown as WalletInterface
	return { wallet, originators, created }
}

describe('adminWallet', () => {
	test('calls the wallet as the admin originator', async () => {
		const { wallet, originators } = mockWallet()
		await adminWallet(wallet, new InMemoryPermissionStore()).listActions({
			labels: ['gib'],
		})
		expect(originators).toEqual([CLI_ADMIN_ORIGINATOR])
	})

	test('reads decrypt, with no grant in the store', async () => {
		const { wallet } = mockWallet()
		// An empty store: an app origin would be refused every one of these.
		const cli = adminWallet(wallet, new InMemoryPermissionStore())

		const actions = await cli.listActions({ labels: ['gib'] })
		expect(actions.actions[0].description).toBe('push refs/heads/main')
		// Values that were never encrypted come back unchanged.
		expect(actions.actions[0].outputs?.[0].outputDescription).toBe(
			'plain and unencrypted',
		)

		const outputs = await cli.listOutputs({ basket: 'gib refs' })
		expect(outputs.outputs[0].customInstructions).toBe('{"id":"1"}')
	})

	test('writes stay plaintext for every other reader of this storage', async () => {
		const { wallet, created } = mockWallet()
		await adminWallet(wallet, new InMemoryPermissionStore()).createAction({
			description: 'sweep',
			outputs: [],
		})
		expect(created[0].description).toBe('sweep')
	})
})
