import { afterEach, describe, expect, test } from 'bun:test'
import { Mandala, buildInscriptionScript } from '@1sat/templates'
import {
	MANDALA_DEPLOY_PROTOCOL,
	MANDALA_LABEL,
	MANDALA_TOPIC,
	ORDINALS_BASKET,
	P1SAT_PROTOCOL,
	mandalaProtocol,
	mandalaTokenBasket,
	mandalaTokenLabel,
	parseMandalaName,
} from '@1sat/types'
import {
	Beef,
	type CreateActionArgs,
	Hash,
	type InternalizeActionArgs,
	LockingScript,
	MerklePath,
	P2PKH,
	PrivateKey,
	ProtoWallet,
	PublicKey,
	type Script,
	Transaction,
	UnlockingScript,
	Utils,
	type WalletInterface,
} from '@bsv/sdk'
import type { OneSatContext } from '../types.js'
import {
	type DeployMandalaInput,
	deployMandala,
	fileMandalaDeploy,
} from './deploy.js'

const proto = new ProtoWallet(PrivateKey.fromHex('01'.repeat(32)))

const OVERLAY = 'https://overlay.example'
const STEAK = { [MANDALA_TOPIC]: { outputsToAdmit: [0], coinsToRetain: [] } }

const realFetch = globalThis.fetch
afterEach(() => {
	globalThis.fetch = realFetch
})

interface Submit {
	url: string
	topics: string | null
	body: number[]
}

/** Fake overlay answering every submit with `body`; records url, X-Topics and the bytes. */
function fakeOverlay(body: unknown = STEAK, order: string[] = []) {
	const submits: Submit[] = []
	globalThis.fetch = (async (
		url: string | URL | Request,
		init?: RequestInit,
	) => {
		order.push('submit')
		submits.push({
			url: String(url),
			topics: new Headers(init?.headers).get('x-topics'),
			body: Array.from(
				new Uint8Array(await (init?.body as Blob).arrayBuffer()),
			),
		})
		return new Response(JSON.stringify(body), { status: 200 })
	}) as typeof fetch
	return submits
}

/** Fake wallet: createAction builds the outputs into a real tx; internalize is recorded. */
function setup() {
	const created: CreateActionArgs[] = []
	const internalized: InternalizeActionArgs[] = []
	const wallet: Partial<WalletInterface> = {
		getPublicKey: (a) => proto.getPublicKey(a),
		createAction: async (args) => {
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
		internalizeAction: async (args) => {
			internalized.push(args)
			return { accepted: true }
		},
	}
	const ctx = {
		wallet: wallet as WalletInterface,
		chain: 'main',
		isBaseWallet: true,
	} as unknown as OneSatContext
	return { ctx, created, internalized }
}

/** The P2PKH the wallet derives under MANDALA_DEPLOY_PROTOCOL for this keyID. */
async function derivedLock(ci: { keyID: string }) {
	const { publicKey } = await proto.getPublicKey({
		protocolID: MANDALA_DEPLOY_PROTOCOL,
		keyID: ci.keyID,
		counterparty: 'self',
		forSelf: true,
	})
	return new P2PKH().lock(PublicKey.fromString(publicKey).toAddress())
}

function expectFiling(
	created: CreateActionArgs[],
	internalized: InternalizeActionArgs[],
	txid: string,
	outputs = 1,
) {
	// one noSend createAction: deploy at vout 0, label `mandala`, derivation-only CI
	expect(created).toHaveLength(1)
	expect(created[0].options?.randomizeOutputs).toBe(false)
	expect(created[0].options?.noSend).toBe(true)
	expect(created[0].labels).toEqual([MANDALA_LABEL])
	expect(created[0].outputs).toHaveLength(outputs)
	// untracked: an output cannot later be moved out of a basket
	expect(created[0].outputs?.[0].basket).toBeUndefined()
	const ci = JSON.parse(created[0].outputs?.[0].customInstructions ?? '{}')
	expect(Object.keys(ci).sort()).toEqual(['keyID', 'protocolID'])
	// deploy key: [2, 'mandala deploy'] (txid unknown at derivation time)
	expect(ci.protocolID).toEqual([2, 'mandala deploy'])
	expect(ci.keyID).toStartWith('mandala-deploy-')

	// one internalizeAction on the same tx: vout 0 into the per-token basket
	expect(internalized).toHaveLength(1)
	const int = internalized[0]
	expect(Transaction.fromAtomicBEEF(int.tx).id('hex')).toBe(txid)
	expect(int.labels).toEqual([MANDALA_LABEL, `mandala ${txid} 0`])
	expect(int.labels).toContain(mandalaTokenLabel({ txid, vout: 0 }))
	expect(int.outputs).toHaveLength(1)
	expect(int.outputs[0].outputIndex).toBe(0)
	expect(int.outputs[0].protocol).toBe('basket insertion')
	const remit = int.outputs[0].insertionRemittance
	expect(remit?.basket).toBe(`mandala ${txid} 0`)
	expect(remit?.basket).toBe(mandalaTokenBasket(`${txid}_0`))
	expect(remit?.customInstructions).toBe(
		created[0].outputs?.[0].customInstructions,
	)
	return { ci, tx: Transaction.fromAtomicBEEF(int.tx) }
}

describe('deployMandala', () => {
	test('fixed supply: createAction + internalize into the per-token basket, tokenId = txid', async () => {
		fakeOverlay()
		const { ctx, created, internalized } = setup()
		const res = await deployMandala.execute(ctx, {
			amount: '21000000',
			symbol: 'GOLD',
			decimals: 8,
			overlay: OVERLAY,
		})

		expect(res.error).toBeUndefined()
		expect(res.txid).toMatch(/^[0-9a-f]{64}$/)
		expect(res.tokenId).toBe(`${res.txid}.0`)
		expect(res.tx).toBeDefined()

		const { ci, tx } = expectFiling(created, internalized, res.txid as string)
		const expected = Mandala.deployValue(21_000_000n, {
			lock: await derivedLock(ci),
			payload: { sym: 'GOLD', dec: 8 },
		})
		expect(created[0].outputs?.[0].lockingScript).toBe(expected.lock().toHex())
		const decoded = Mandala.decode(tx.outputs[0].lockingScript as Script)
		expect(decoded?.role).toBe('deploy')
		expect(decoded?.amount).toBe(21_000_000n)
		expect(decoded?.metadata).toEqual({ sym: 'GOLD', dec: 8 })
	})

	test('authority: amount 0 deploys the first authority, filed the same way', async () => {
		fakeOverlay()
		const { ctx, created, internalized } = setup()
		const res = await deployMandala.execute(ctx, {
			amount: 0n,
			symbol: 'STABLE',
			decimals: 2,
			icon: 1,
			overlay: OVERLAY,
		})

		expect(res.error).toBeUndefined()
		expect(res.tokenId).toBe(`${res.txid}.0`)

		const { ci, tx } = expectFiling(created, internalized, res.txid as string)
		const expected = Mandala.deployAuthority({
			lock: await derivedLock(ci),
			payload: { sym: 'STABLE', dec: 2, icon: 1 },
		})
		expect(created[0].outputs?.[0].lockingScript).toBe(expected.lock().toHex())
		const decoded = Mandala.decode(tx.outputs[0].lockingScript as Script)
		expect(decoded?.role).toBe('deploy')
		expect(decoded?.amount).toBe(0n)
	})

	test('an address destination carries no customInstructions', async () => {
		fakeOverlay()
		const { ctx, created, internalized } = setup()
		const res = await deployMandala.execute(ctx, {
			amount: '5',
			destination: {
				address: PrivateKey.fromHex('06'.repeat(32)).toPublicKey().toAddress(),
			},
			overlay: OVERLAY,
		})
		expect(res.error).toBeUndefined()
		expect(created[0].outputs?.[0].customInstructions).toBeUndefined()
		expect(
			internalized[0].outputs[0].insertionRemittance?.customInstructions,
		).toBeUndefined()
	})

	test('names: `mandala <txid> <vout>` from {txid, vout}, txid_vout or txid.vout', () => {
		const txid = 'AB'.repeat(32)
		const name = `mandala ${'ab'.repeat(32)} 3`
		for (const ref of [{ txid, vout: 3 }, `${txid}_3`, `${txid}.3`]) {
			expect(mandalaTokenBasket(ref)).toBe(name)
			expect(mandalaTokenLabel(ref)).toBe(name)
			expect(mandalaProtocol(ref)).toEqual([2, name])
		}
		expect(() => mandalaProtocol(txid)).toThrow()
	})

	test('parseMandalaName recovers {txid, vout} from basket, label or protocol', () => {
		const txid = 'ab'.repeat(32)
		expect(parseMandalaName(`mandala ${txid} 7`)).toEqual({ txid, vout: 7 })
		expect(parseMandalaName([2, `mandala ${txid} 0`])).toEqual({
			txid,
			vout: 0,
		})
		expect(parseMandalaName('mandala')).toBeUndefined()
		expect(parseMandalaName('mandala deploy')).toBeUndefined()
		expect(parseMandalaName(`mandala ${txid}_0`)).toBeUndefined()
	})
})

describe('deployMandala filing retry', () => {
	test('a failed internalize returns txid/tx/error; fileMandalaDeploy re-files from listActions', async () => {
		fakeOverlay()
		const { ctx, created, internalized } = setup()
		const internalize = ctx.wallet.internalizeAction
		let fail = true
		ctx.wallet.internalizeAction = async (args) => {
			if (fail) throw new Error('storage busy')
			return internalize(args)
		}
		const res = await deployMandala.execute(ctx, {
			amount: '7',
			overlay: OVERLAY,
		})
		expect(res.error).toBe('file-failed: storage busy')
		expect(res.txid).toMatch(/^[0-9a-f]{64}$/)
		expect(res.tokenId).toBe(`${res.txid}.0`)
		expect(internalized).toHaveLength(0)

		const ciString = created[0].outputs?.[0].customInstructions
		const listCalls: unknown[] = []
		ctx.wallet.listActions = async (args) => {
			listCalls.push(args)
			return {
				totalActions: 1,
				actions: [
					{
						txid: res.txid as string,
						satoshis: 0,
						status: 'completed',
						isOutgoing: true,
						description: 'Deploy Mandala token (fixed supply)',
						labels: [MANDALA_LABEL],
						version: 1,
						lockTime: 0,
						outputs: [
							{
								outputIndex: 0,
								satoshis: 1,
								spendable: true,
								tags: [],
								outputDescription: 'Mandala deploy',
								basket: '',
								customInstructions: ciString,
							},
						],
					},
				],
			}
		}
		fail = false
		const filed = await fileMandalaDeploy.execute(ctx, {
			txid: res.txid as string,
			tx: res.tx,
		})
		expect(filed.error).toBeUndefined()
		expect(filed.tokenId).toBe(`${res.txid}.0`)
		expect(listCalls).toEqual([
			{ labels: [MANDALA_LABEL], includeOutputs: true, limit: 10000 },
		])
		expectFiling(created, internalized, res.txid as string)
	})

	test('fileMandalaDeploy: unknown txid', async () => {
		const { ctx } = setup()
		ctx.wallet.listActions = async () => ({ totalActions: 0, actions: [] })
		const filed = await fileMandalaDeploy.execute(ctx, {
			txid: 'cd'.repeat(32),
		})
		expect(filed.error).toBe('deploy-not-found')
	})
})

describe('deployMandala overlay', () => {
	test('overlay is required: without it nothing is created or submitted', async () => {
		const submits = fakeOverlay()
		const { ctx, created, internalized } = setup()
		const res = await deployMandala.execute(ctx, {
			amount: '5',
		} as DeployMandalaInput)
		expect(res.error).toBe('overlay-required')
		expect(created).toHaveLength(0)
		expect(submits).toHaveLength(0)
		expect(internalized).toHaveLength(0)
		expect(deployMandala.meta.inputSchema.required).toEqual([
			'amount',
			'overlay',
		])
	})

	test('STEAK answer: creates with noSend, submits to tm_mandala before internalizing', async () => {
		const order: string[] = []
		const submits = fakeOverlay(
			{ [MANDALA_TOPIC]: { outputsToAdmit: [0], coinsToRetain: [] } },
			order,
		)

		const { ctx, created, internalized } = setup()
		const internalize = ctx.wallet.internalizeAction
		ctx.wallet.internalizeAction = async (args) => {
			order.push('internalize')
			return internalize(args)
		}

		const res = await deployMandala.execute(ctx, {
			amount: '1000',
			symbol: 'OVL',
			overlay: 'https://overlay.example/',
		})

		expect(res.error).toBeUndefined()
		expect(res.tokenId).toBe(`${res.txid}.0`)
		expect(created[0].options?.noSend).toBe(true)
		// the discovery topic tm_mandala only
		// no icon: the body is the deploy's Atomic BEEF
		expect(submits).toEqual([
			{
				url: 'https://overlay.example/submit',
				topics: MANDALA_TOPIC,
				body: res.tx as number[],
			},
		])
		expect(order).toEqual(['submit', 'internalize'])
		expectFiling(created, internalized, res.txid as string)
	})

	test('a {id} answer is not a STEAK: overlay-no-steak and nothing is filed', async () => {
		fakeOverlay({ id: 'sub-42' })
		const { ctx, internalized } = setup()
		const res = await deployMandala.execute(ctx, {
			amount: '5',
			overlay: 'https://overlay.example',
		})
		expect(res.error).toBe('overlay-no-steak')
		expect(res.txid).toMatch(/^[0-9a-f]{64}$/)
		expect(res.tokenId).toBeUndefined()
		expect(internalized).toHaveLength(0)
	})

	test('a STEAK without tm_mandala, or with a malformed entry, is overlay-no-steak', async () => {
		for (const answer of [
			{ tm_other: { outputsToAdmit: [0], coinsToRetain: [] } },
			{ [MANDALA_TOPIC]: { outputsToAdmit: [0] } },
			{ [MANDALA_TOPIC]: { outputsToAdmit: ['0'], coinsToRetain: [] } },
			{
				[MANDALA_TOPIC]: { outputsToAdmit: [0], coinsToRetain: [] },
				id: 'sub-42',
			},
		]) {
			fakeOverlay(answer)
			const { ctx, internalized } = setup()
			const res = await deployMandala.execute(ctx, {
				amount: '5',
				overlay: 'https://overlay.example',
			})
			expect(res.error).toBe('overlay-no-steak')
			expect(internalized).toHaveLength(0)
		}
	})

	test('a non-object answer is overlay-no-steak and nothing is filed', async () => {
		fakeOverlay([])
		const { ctx, internalized } = setup()
		const res = await deployMandala.execute(ctx, {
			amount: '5',
			overlay: 'https://overlay.example',
		})
		expect(res.error).toBe('overlay-no-steak')
		expect(res.txid).toMatch(/^[0-9a-f]{64}$/)
		expect(internalized).toHaveLength(0)
	})
})

describe('deployMandala icon', () => {
	const PNG = Utils.toBase64(Utils.toArray('not really a png', 'utf8'))

	/** A mined icon inscription at vout 0, in a BEEF of its own. */
	function iconBeef() {
		const iconTx = new Transaction()
		iconTx.addInput({
			sourceTXID: '33'.repeat(32),
			sourceOutputIndex: 0,
			unlockingScript: new UnlockingScript(),
			sequence: 0xffffffff,
		})
		iconTx.addOutput({
			lockingScript: buildInscriptionScript(
				new P2PKH().lock(
					PrivateKey.fromHex('08'.repeat(32)).toPublicKey().toAddress(),
				),
				new Uint8Array(Utils.toArray(PNG, 'base64')),
				'image/png',
			),
			satoshis: 1,
		})
		iconTx.merklePath = new MerklePath(200, [
			[{ offset: 0, hash: iconTx.id('hex'), txid: true }],
		])
		const beef = new Beef()
		beef.mergeTransaction(iconTx)
		return { txid: iconTx.id('hex'), beef }
	}

	/** Fake services: getBeefForTxid answers `beef` and records the txids asked for. */
	function withServices(ctx: OneSatContext, beef: Beef) {
		const fetched: string[] = []
		;(ctx as { services?: unknown }).services = {
			getBeefForTxid: async (txid: string) => {
				fetched.push(txid)
				return beef
			},
		}
		return fetched
	}

	/** BRC-233 Subject BEEF about the deploy: BEEF V2 with the deploy, its parent and the icon. */
	function expectSubjectBeef(body: number[], txid: string, iconTxid: string) {
		expect(body.slice(0, 4)).toEqual([0x57, 0x09, 0xbe, 0xef])
		expect(Utils.toHex(body.slice(4, 36).reverse())).toBe(txid)
		expect(body.slice(36, 40)).toEqual([0x02, 0x00, 0xbe, 0xef])
		const inner = Beef.fromBinary(body.slice(36))
		const deployTx = inner.findTxid(txid)?.tx
		expect(deployTx).toBeDefined()
		const parent = deployTx?.inputs[0].sourceTXID as string
		expect(inner.findTxid(parent)?.tx).toBeDefined()
		expect(inner.findTxid(iconTxid)?.tx).toBeDefined()
		// the icon is no ancestor of the deploy
		expect(deployTx?.inputs.map((i) => i.sourceTXID)).not.toContain(iconTxid)
	}

	test('external icon with its BEEF: checked, encoded as txid_vout, submitted as Subject BEEF; nothing fetched', async () => {
		const icon = iconBeef()
		const submits = fakeOverlay()
		const { ctx, created, internalized } = setup()
		const fetched = withServices(ctx, new Beef())
		const res = await deployMandala.execute(ctx, {
			amount: '100',
			icon: { outpoint: `${icon.txid}.0`, beef: icon.beef.toBinary() },
			overlay: OVERLAY,
		})

		expect(res.error).toBeUndefined()
		expect(fetched).toHaveLength(0)
		const { tx } = expectFiling(created, internalized, res.txid as string)
		expect(
			Mandala.decode(tx.outputs[0].lockingScript as Script)?.metadata,
		).toEqual({ icon: `${icon.txid}_0` })
		expect(submits).toHaveLength(1)
		expectSubjectBeef(submits[0].body, res.txid as string, icon.txid)
		// the result and the filing keep the deploy's Atomic BEEF
		expect(internalized[0].tx).toEqual(res.tx as number[])
	})

	test('external icon without a BEEF (a bare outpoint string): fetched from services, Subject BEEF', async () => {
		const icon = iconBeef()
		const submits = fakeOverlay()
		const { ctx, created, internalized } = setup()
		const fetched = withServices(ctx, icon.beef)
		const res = await deployMandala.execute(ctx, {
			amount: '100',
			icon: `${icon.txid}_0`,
			overlay: OVERLAY,
		})

		expect(res.error).toBeUndefined()
		expect(fetched).toEqual([icon.txid])
		const { tx } = expectFiling(created, internalized, res.txid as string)
		expect(
			Mandala.decode(tx.outputs[0].lockingScript as Script)?.metadata?.icon,
		).toBe(`${icon.txid}_0`)
		expectSubjectBeef(submits[0].body, res.txid as string, icon.txid)
	})

	test('external icon without a BEEF and no services: error, nothing created', async () => {
		const icon = iconBeef()
		const submits = fakeOverlay()
		const { ctx, created, internalized } = setup()
		for (const iconInput of [
			`${icon.txid}_0`,
			{ outpoint: `${icon.txid}.0` },
		]) {
			const res = await deployMandala.execute(ctx, {
				amount: '100',
				icon: iconInput,
				overlay: OVERLAY,
			})
			expect(res).toEqual({ error: 'icon-services-required' })
		}
		expect(created).toHaveLength(0)
		expect(submits).toHaveLength(0)
		expect(internalized).toHaveLength(0)
	})

	test('a given BEEF without the icon transaction or vout: error, nothing created, no fetch', async () => {
		const icon = iconBeef()
		const submits = fakeOverlay()
		const { ctx, created } = setup()
		const fetched = withServices(ctx, icon.beef)

		const missingTx = await deployMandala.execute(ctx, {
			amount: '100',
			icon: { outpoint: `${'44'.repeat(32)}_0`, beef: icon.beef.toBinary() },
			overlay: OVERLAY,
		})
		expect(missingTx).toEqual({ error: 'icon-beef-missing-tx' })

		const missingVout = await deployMandala.execute(ctx, {
			amount: '100',
			icon: { outpoint: `${icon.txid}_1`, beef: icon.beef.toBinary() },
			overlay: OVERLAY,
		})
		expect(missingVout).toEqual({ error: 'icon-beef-missing-vout' })

		expect(fetched).toHaveLength(0)
		expect(created).toHaveLength(0)
		expect(submits).toHaveLength(0)
	})

	test('inline icon: inscribed at vout 1 in basket 1sat, payload icon = 1, Atomic BEEF submitted, only vout 0 filed', async () => {
		const submits = fakeOverlay()
		const { ctx, created, internalized } = setup()
		const res = await deployMandala.execute(ctx, {
			amount: '100',
			symbol: 'ART',
			icon: { base64Content: PNG, contentType: 'image/png' },
			overlay: OVERLAY,
		})

		expect(res.error).toBeUndefined()
		const { tx } = expectFiling(created, internalized, res.txid as string, 2)
		expect(
			Mandala.decode(tx.outputs[0].lockingScript as Script)?.metadata,
		).toEqual({ sym: 'ART', icon: 1 })

		const out = created[0].outputs?.[1]
		const sha = Utils.toHex(Hash.sha256(Utils.toArray(PNG, 'base64')))
		const tags = ['type:image/png', 'origin', `sha256:${sha}`]
		expect(out?.satoshis).toBe(1)
		expect(out?.basket).toBe(ORDINALS_BASKET)
		// the inscribe tags, plus the `id:` tracking tag executeTrackedAction stamps
		expect(out?.tags?.slice(0, 3)).toEqual(tags)
		expect(out?.tags?.slice(3)).toEqual([expect.stringMatching(/^id:/)])
		const ci = JSON.parse(out?.customInstructions ?? '{}')
		expect(ci.protocolID).toEqual(P1SAT_PROTOCOL)
		expect(ci.keyID).toStartWith('inscribe-')
		const { publicKey } = await proto.getPublicKey({
			protocolID: P1SAT_PROTOCOL,
			keyID: ci.keyID,
			counterparty: 'self',
			forSelf: true,
		})
		expect(out?.lockingScript).toBe(
			buildInscriptionScript(
				new P2PKH().lock(PublicKey.fromString(publicKey).toAddress()),
				new Uint8Array(Utils.toArray(PNG, 'base64')),
				'image/png',
			).toHex(),
		)
		expect(tx.outputs[1].lockingScript.toHex()).toBe(
			out?.lockingScript as string,
		)

		// same-tx icon: Atomic BEEF, as without an icon
		expect(submits[0].body).toEqual(res.tx as number[])
		expect(submits[0].body.slice(0, 4)).toEqual([1, 1, 1, 1])
	})

	test('a number icon is encoded as is and submitted as Atomic BEEF', async () => {
		const submits = fakeOverlay()
		const { ctx, created } = setup()
		const res = await deployMandala.execute(ctx, {
			amount: '100',
			icon: 3,
			overlay: OVERLAY,
		})
		expect(res.error).toBeUndefined()
		expect(created[0].outputs).toHaveLength(1)
		expect(submits[0].body).toEqual(res.tx as number[])
		expect(submits[0].body.slice(0, 4)).toEqual([1, 1, 1, 1])
	})
})
