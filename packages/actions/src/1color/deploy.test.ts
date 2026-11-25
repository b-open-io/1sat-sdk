import { describe, expect, test } from 'bun:test'
import { OneColor } from '@1sat/templates'
import {
	COLOR_KEY_ID,
	ColorPermissionModule,
	ColorPlan,
	ISSUE,
	colorProtocolID,
} from '@bsv/color-permission-module'
import {
	type CreateActionArgs,
	LockingScript,
	MerklePath,
	P2PKH,
	PrivateKey,
	ProtoWallet,
	PublicKey,
	Transaction,
	UnlockingScript,
	type WalletInterface,
} from '@bsv/sdk'
import type { OneSatContext } from '../types.js'
import { deploy1Color } from './deploy.js'

const KEY = PrivateKey.fromHex('01'.repeat(32))
const IDENTITY = KEY.toPublicKey().toString()
const proto = new ProtoWallet(KEY)

/** Fake wallet: createAction builds the outputs into a real tx; nothing else is allowed. */
function setup() {
	const created: CreateActionArgs[] = []
	const other: string[] = []
	const wallet = {
		getPublicKey: (a: Parameters<WalletInterface['getPublicKey']>[0]) =>
			proto.getPublicKey(a),
		createAction: async (args: CreateActionArgs) => {
			created.push(args)
			const parent = new Transaction()
			parent.addInput({
				sourceTXID: '11'.repeat(32),
				sourceOutputIndex: 0,
				unlockingScript: new UnlockingScript(),
				sequence: 0xffffffff,
			})
			parent.addOutput({
				lockingScript: new P2PKH().lock(
					PrivateKey.fromHex('05'.repeat(32)).toPublicKey().toAddress(),
				),
				satoshis: 100_000,
			})
			parent.merklePath = new MerklePath(100, [
				[{ offset: 0, hash: parent.id('hex'), txid: true }],
			])
			const tx = new Transaction()
			tx.addInput({
				sourceTransaction: parent,
				sourceOutputIndex: 0,
				unlockingScript: new UnlockingScript(),
				sequence: 0xffffffff,
			})
			for (const o of args.outputs ?? []) {
				tx.addOutput({
					lockingScript: LockingScript.fromHex(o.lockingScript),
					satoshis: o.satoshis,
				})
			}
			return { txid: tx.id('hex'), tx: tx.toAtomicBEEF() }
		},
	}
	const ctx = {
		wallet: new Proxy(wallet, {
			get(target, prop) {
				if (prop in target) return target[prop as keyof typeof target]
				return () => {
					other.push(String(prop))
					throw new Error(`unexpected wallet call ${String(prop)}`)
				}
			},
		}) as unknown as WalletInterface,
		chain: 'main',
		isBaseWallet: true,
	} as unknown as OneSatContext
	return { ctx, created, other }
}

/** The one createAction, checked exactly; returns its plan and deploy output. */
async function expectDeployAction(
	created: CreateActionArgs[],
	operation: 'deploy-fixed' | 'deploy-authority',
) {
	expect(created).toHaveLength(1)
	const args = created[0]
	const plan = ColorPlan.fromLabels(args.labels)
	expect(plan).toBeDefined()
	const owned = plan!.ownedOutputs[0]
	expect(plan).toEqual({
		version: 1,
		assets: [ISSUE],
		ownedOutputs: [
			{
				outputIndex: 0,
				assetId: ISSUE,
				derivationPrefix: owned.derivationPrefix,
				derivationSuffix: owned.derivationSuffix,
				senderIdentityKey: IDENTITY,
			},
		],
		operations: [{ assetId: ISSUE, operation }],
		inputPositions: [],
		changePositions: [],
		sighashTypes: [],
	})
	// Fresh random base64 remittance strings.
	expect(owned.derivationPrefix).toMatch(/^[A-Za-z0-9+/]{22}==$/)
	expect(owned.derivationSuffix).toMatch(/^[A-Za-z0-9+/]{22}==$/)
	expect(owned.derivationPrefix).not.toBe(owned.derivationSuffix)
	// The labels are exactly the plan's labels: no other label.
	expect(args.labels).toEqual(ColorPlan.toLabels(plan!))
	expect(args.options).toEqual({ randomizeOutputs: false })
	expect(args.inputs).toBeUndefined()
	expect(args.inputBEEF).toBeUndefined()
	expect(args.outputs).toHaveLength(1)
	const out = args.outputs![0]
	expect(Object.keys(out).sort()).toEqual([
		'lockingScript',
		'outputDescription',
		'satoshis',
	])
	expect(out.satoshis).toBe(1)

	// Output 0 is locked to the ISSUE key the module checks: protocol
	// `p color issue <prefixHex> <suffixHex>`, keyID `color`, our own key.
	const { publicKey } = await proto.getPublicKey({
		protocolID: colorProtocolID(
			ISSUE,
			owned.derivationPrefix,
			owned.derivationSuffix,
		),
		keyID: COLOR_KEY_ID,
		counterparty: IDENTITY,
		forSelf: true,
	})
	const token = OneColor.decode(LockingScript.fromHex(out.lockingScript))
	expect(token?.role).toBe('deploy')
	expect(token?.lock.toHex()).toBe(
		new P2PKH().lock(PublicKey.fromString(publicKey).toAddress()).toHex(),
	)
	return { args, plan: plan!, token: token! }
}

describe('deploy1Color', () => {
	test('fixed supply: one createAction carrying the ISSUE plan; no basket, instructions or internalize', async () => {
		const { ctx, created, other } = setup()
		const res = await deploy1Color.execute(ctx, {
			amount: '21000000',
			symbol: 'GOLD',
			decimals: 8,
		})
		expect(res.error).toBeUndefined()
		const { args, token } = await expectDeployAction(created, 'deploy-fixed')
		expect(args.description).toBe('Deploy 1Color token (fixed supply)')
		expect(token.amount).toBe(21_000_000n)
		expect(token.metadata).toEqual({ sym: 'GOLD', dec: 8 })
		expect(res.assetId).toBe(`${res.txid}_0`)
		expect(Transaction.fromAtomicBEEF(res.tx!).id('hex')).toBe(res.txid!)
		expect(other).toEqual([])
	})

	test('authority: amount 0 is a deploy-authority operation', async () => {
		const { ctx, created } = setup()
		const res = await deploy1Color.execute(ctx, { amount: 0n })
		expect(res.error).toBeUndefined()
		const { args, token } = await expectDeployAction(
			created,
			'deploy-authority',
		)
		expect(args.description).toBe('Deploy 1Color token (authority)')
		expect(token.amount).toBe(0n)
		expect(token.payload).toBeUndefined()
	})

	test('the icon is embedded as [mediaType, bytes]', async () => {
		const { ctx, created } = setup()
		const res = await deploy1Color.execute(ctx, {
			amount: '1',
			icon: { mediaType: 'image/png', bytes: [0x89, 0x50, 0x4e, 0x47] },
		})
		expect(res.error).toBeUndefined()
		const { token } = await expectDeployAction(created, 'deploy-fixed')
		expect(token.metadata).toEqual({
			icon: {
				mediaType: 'image/png',
				bytes: Uint8Array.of(0x89, 0x50, 0x4e, 0x47),
			},
		})
		expect(token.payloadMap?.icon).toEqual([
			'image/png',
			Uint8Array.of(0x89, 0x50, 0x4e, 0x47),
		])
	})

	test("the color module's createAction handler accepts the request as an owned deploy", async () => {
		const { ctx, created } = setup()
		await deploy1Color.execute(ctx, { amount: '5' })
		const module = new ColorPermissionModule({
			wallet: proto as unknown as WalletInterface,
			provider: {} as never,
			requestTokenAccess: async () => true,
		})
		const { args } = (await module.onRequest({
			method: 'createAction',
			args: created[0],
			originator: 'app.example',
		} as never)) as { args: CreateActionArgs }
		// The module keeps the plan and adds the encrypted custody of the
		// owned deploy; it adds no inputs (it funds no token value here).
		expect(args.labels).toEqual(created[0].labels)
		expect(args.outputs?.[0].lockingScript).toBe(
			created[0].outputs?.[0].lockingScript,
		)
		expect(typeof args.outputs?.[0].customInstructions).toBe('string')
	})

	test('a bad decimals value fails before createAction', async () => {
		const { ctx, created } = setup()
		const res = await deploy1Color.execute(ctx, { amount: '1', decimals: 19 })
		expect(res.error).toBe('dec must be an integer 0-18')
		expect(created).toHaveLength(0)
	})
})
