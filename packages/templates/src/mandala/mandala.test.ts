import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
	LockingScript,
	P2PKH,
	PrivateKey,
	Script,
	Spend,
	Transaction,
	Utils,
} from '@bsv/sdk'
import { encode as dagCborEncode } from '@ipld/dag-cbor'
import BSV21 from '../bsv21/bsv21.js'
import Mandala, {
	DagCborLink,
	type DagCborValue,
	decodeDagCbor,
	MANDALA_MAX_AMOUNT,
} from './mandala.js'

// Transactions from amm-poc programs/amm-topic/src/fixtures/vectors.zig (2a9ea90)
function fixture(name: string): Transaction {
	const hex = readFileSync(
		join(import.meta.dir, 'testdata', `${name}.hex`),
		'utf8',
	)
	return Transaction.fromHex(hex.trim())
}

const hex = (b: number[] | Uint8Array) => Utils.toHex(Array.from(b))
const P2PKH_HEX = `76a914${'ab'.repeat(20)}88ac`
const P2PKH_LOCK = LockingScript.fromHex(P2PKH_HEX)
const TXID = `${'01'.repeat(31)}ff` // display order
const ID0 = `${TXID}_0`
const ID3 = `${TXID}_3`
const ID0_BYTES = Utils.toArray(TXID, 'hex').reverse()
const ID3_BYTES = [...ID0_BYTES, 3, 0, 0, 0]

describe('Mandala token ids', () => {
	it('vout 0 is 32 bytes, natural-order txid', () => {
		expect(hex(Mandala.idFromString(ID0))).toBe(hex(ID0_BYTES))
		expect(Mandala.idToString(Uint8Array.from(ID0_BYTES))).toBe(ID0)
	})

	it('non-zero vout is 36 bytes with a LE vout', () => {
		expect(hex(Mandala.idFromString(ID3))).toBe(hex(ID3_BYTES))
		expect(Mandala.idToString(ID3_BYTES)).toBe(ID3)
		const big = `${TXID}_4294967295`
		expect(Mandala.idToString(Mandala.idFromString(big))).toBe(big)
	})

	it('rejects a 36-byte id with vout 0 and bad lengths / strings', () => {
		expect(() => Mandala.idToString([...ID0_BYTES, 0, 0, 0, 0])).toThrow()
		expect(() => Mandala.idToString(ID0_BYTES.slice(1))).toThrow()
		expect(() => Mandala.idFromString(TXID)).toThrow()
		expect(() => Mandala.idFromString(`${TXID}.0`)).toThrow()
		expect(() => Mandala.idFromString(`${TXID}_4294967296`)).toThrow()
	})
})

describe('Mandala lock / decode round-trips', () => {
	const cases: [string, Mandala, string, string | undefined, bigint][] = [
		[
			'deploy value',
			Mandala.deployValue(21_000_000n, { lock: P2PKH_LOCK }),
			'deploy',
			undefined,
			21_000_000n,
		],
		[
			'deploy authority',
			Mandala.deployAuthority({ lock: P2PKH_LOCK }),
			'deploy',
			undefined,
			0n,
		],
		[
			'deploy(undefined)',
			Mandala.deploy(undefined, { lock: P2PKH_LOCK }),
			'deploy',
			undefined,
			0n,
		],
		[
			'value 32-byte id',
			Mandala.value(ID0, 5000n, { lock: P2PKH_LOCK }),
			'value',
			ID0,
			5000n,
		],
		[
			'value 36-byte id',
			Mandala.value(ID3, 5000n, { lock: P2PKH_LOCK }),
			'value',
			ID3,
			5000n,
		],
		[
			'authority 32-byte id',
			Mandala.authority(ID0, { lock: P2PKH_LOCK }),
			'authority',
			ID0,
			0n,
		],
		[
			'authority 36-byte id',
			Mandala.authority(ID3, { lock: P2PKH_LOCK }),
			'authority',
			ID3,
			0n,
		],
		[
			'value from id bytes',
			Mandala.value(Uint8Array.from(ID3_BYTES), 7n, { lock: P2PKH_LOCK }),
			'value',
			ID3,
			7n,
		],
	]
	for (const [name, t, role, id, amount] of cases) {
		it(name, () => {
			expect(t.role).toBe(role as typeof t.role)
			expect(t.tokenId).toBe(id)
			const d = Mandala.decode(t.lock())
			expect(d).not.toBeNull()
			expect(d?.role).toBe(role as typeof t.role)
			expect(d?.tokenId).toBe(id)
			expect(d?.amount).toBe(amount)
			expect(d?.payload).toBeUndefined()
			expect(d?.lock.toHex()).toBe(P2PKH_HEX)
			if (id) expect(d?.idBytes?.length).toBe(id.endsWith('_0') ? 32 : 36)
		})
	}

	it('writes the exact prefix bytes', () => {
		expect(Mandala.deployAuthority({ lock: P2PKH_LOCK }).lock().toHex()).toBe(
			`00006d${P2PKH_HEX}`,
		)
		expect(Mandala.value(ID0, 5000n, { lock: P2PKH_LOCK }).lock().toHex()).toBe(
			`20${hex(ID0_BYTES)}0288136d${P2PKH_HEX}`,
		)
		expect(Mandala.authority(ID3, { lock: P2PKH_LOCK }).lock().toHex()).toBe(
			`24${hex(ID3_BYTES)}006d${P2PKH_HEX}`,
		)
	})

	it('builds a P2PKH from an address or pubkey hash', () => {
		const key = PrivateKey.fromRandom()
		const address = key.toAddress()
		const expected = new P2PKH().lock(address).toHex()
		expect(Mandala.value(ID0, 1n, { lock: address }).inner.toHex()).toBe(
			expected,
		)
		const pkh = key.toPublicKey().toHash() as number[]
		expect(Mandala.value(ID0, 1n, { lock: pkh }).inner.toHex()).toBe(expected)
	})

	it('accepts any inner script, including an empty one', () => {
		const inner = Script.fromASM('OP_TRUE')
		expect(
			Mandala.decode(
				Mandala.value(ID0, 2n, { lock: inner }).lock(),
			)?.lock.toHex(),
		).toBe('51')
		const empty = Mandala.decode(
			Mandala.value(ID0, 2n, { lock: new LockingScript() }).lock(),
		)
		expect(empty?.lock.toHex()).toBe('')
	})

	it('builder rejects invalid amounts and ids', () => {
		expect(() => Mandala.value(ID0, 0n, { lock: P2PKH_LOCK })).toThrow()
		expect(() => Mandala.value(ID0, -1n, { lock: P2PKH_LOCK })).toThrow()
		expect(() =>
			Mandala.value(ID0, MANDALA_MAX_AMOUNT + 1n, { lock: P2PKH_LOCK }),
		).toThrow()
		expect(() => Mandala.deployValue(0n, { lock: P2PKH_LOCK })).toThrow()
		expect(() =>
			Mandala.authority(Uint8Array.from([...ID0_BYTES, 0, 0, 0, 0]), {
				lock: P2PKH_LOCK,
			}),
		).toThrow()
	})
})

describe('Mandala amounts: minimal pushes', () => {
	const cases: [bigint, string][] = [
		[1n, '51'],
		[16n, '60'],
		[17n, '0111'],
		[127n, '017f'],
		[128n, '028000'],
		[255n, '02ff00'],
		[256n, '020001'],
		[2n ** 31n, '050000008000'],
		[2n ** 63n - 1n, '08ffffffffffffff7f'],
		[2n ** 63n, '09000000000000008000'],
		[MANDALA_MAX_AMOUNT, '09ffffffffffffffff00'],
	]
	for (const [amount, push] of cases) {
		it(`${amount}`, () => {
			const script = Mandala.value(ID0, amount, { lock: P2PKH_LOCK }).lock()
			expect(script.toHex()).toBe(`20${hex(ID0_BYTES)}${push}6d${P2PKH_HEX}`)
			expect(Mandala.decode(script)?.amount).toBe(amount)
		})
	}

	it('authority amount is OP_0', () => {
		expect(Mandala.authority(ID0, { lock: P2PKH_LOCK }).lock().toHex()).toBe(
			`20${hex(ID0_BYTES)}006d${P2PKH_HEX}`,
		)
	})
})

describe('Mandala.decode rejects', () => {
	const id = `20${hex(ID0_BYTES)}`
	const bad: [string, string][] = [
		['empty script', ''],
		['plain P2PKH', P2PKH_HEX],
		['no OP_2DROP', `${id}51${P2PKH_HEX}`],
		['truncated after amount', `${id}51`],
		['OP_DROP instead of OP_2DROP', `${id}5175`],
		['id of 31 bytes', `1f${hex(ID0_BYTES.slice(1))}516d`],
		['id of 33 bytes', `21${hex(ID0_BYTES)}00516d`],
		['36-byte id with vout 0', `24${hex(ID0_BYTES)}00000000516d`],
		['32-byte id via PUSHDATA1', `4c20${hex(ID0_BYTES)}516d`],
		['36-byte id via PUSHDATA2', `4d2400${hex(ID3_BYTES)}516d`],
		['id as OP_1', '51516d'],
		['amount 0 as direct push', `${id}01006d`],
		['amount 1 as direct push', `${id}01016d`],
		['amount 16 as direct push', `${id}01106d`],
		['amount 17 via PUSHDATA1', `${id}4c01116d`],
		['amount non-minimal (17 padded)', `${id}0211006d`],
		['amount negative (0x91 = -17)', `${id}01916d`],
		['amount negative zero', `${id}01806d`],
		['amount OP_1NEGATE', `${id}4f6d`],
		['amount above 2^64-1', `${id}09${'00'.repeat(8)}016d`],
		['amount of 10 bytes', `${id}0a${'ff'.repeat(9)}006d`],
		['truncated id push', `20${hex(ID0_BYTES.slice(2))}`],
		['id is a non-push opcode', '76516d'],
	]
	for (const [name, script] of bad) {
		it(name, () => {
			expect(Mandala.decode(Script.fromHex(script))).toBeNull()
		})
	}
})

describe('Mandala payload', () => {
	it('round-trips display fields as DAG-CBOR on a deploy', () => {
		const icon = `${'11'.repeat(32)}_1`
		const t = Mandala.deployValue(21_000_000n, {
			lock: P2PKH_LOCK,
			payload: { sym: 'GOLD', dec: 8, icon },
		})
		// length-first key order: dec, sym, icon
		const cbor = `a36364656308${'6373796d64474f4c44'}6469636f6e5824${'11'.repeat(32)}01000000`
		expect(hex(t.payload ?? [])).toBe(cbor)
		const script = t.lock()
		expect(cbor.length / 2).toBe(0x3a)
		expect(script.toHex()).toBe(`0004406f40016d3a${cbor}75${P2PKH_HEX}`)
		const d = Mandala.decode(script)
		expect(d?.role).toBe('deploy')
		expect(d?.amount).toBe(21_000_000n)
		expect(hex(d?.payload ?? [])).toBe(cbor)
		expect(d?.payloadMap?.sym).toBe('GOLD')
		expect(d?.metadata).toEqual({ sym: 'GOLD', dec: 8, icon })
		expect(d?.lock.toHex()).toBe(P2PKH_HEX)
	})

	it('spec example: {"sym":"STABLE","dec":2} on an authority deploy, 4-byte icon', () => {
		const t = Mandala.deployAuthority({
			lock: P2PKH_LOCK,
			payload: { sym: 'STABLE', dec: 2, icon: 1 },
		})
		const d = Mandala.decode(t.lock())
		expect(d?.metadata).toEqual({ sym: 'STABLE', dec: 2, icon: 1 })
		expect(hex(d?.payloadMap?.icon as Uint8Array)).toBe('01000000')
	})

	it('short payloads use a direct push, not PUSHDATA', () => {
		const t = Mandala.deployAuthority({
			lock: P2PKH_LOCK,
			payload: { sym: 'X' },
		})
		expect(t.lock().toHex()).toBe(`00006d07a16373796d615875${P2PKH_HEX}`)
	})

	it('empty display fields omit the payload', () => {
		expect(
			Mandala.deployAuthority({ lock: P2PKH_LOCK, payload: {} }).payload,
		).toBeUndefined()
	})

	it('rejects invalid display fields when building', () => {
		expect(() =>
			Mandala.deploy(1n, { lock: P2PKH_LOCK, payload: { dec: 19 } }),
		).toThrow()
		expect(() =>
			Mandala.deploy(1n, { lock: P2PKH_LOCK, payload: { icon: 'nope' } }),
		).toThrow()
	})

	it('raw payload on a value output: minimal pushes for every size', () => {
		const sizes: [number[], string][] = [
			[[], '00'],
			[[0x05], '55'],
			[[0x10], '60'],
			[[0x81], '4f'],
			[[0x11], '0111'],
			[[0x00], '0100'],
			[Array(75).fill(7), `4b${'07'.repeat(75)}`],
			[Array(76).fill(7), `4c4c${'07'.repeat(76)}`],
			[Array(256).fill(7), `4d0001${'07'.repeat(256)}`],
		]
		for (const [bytes, push] of sizes) {
			const s = Mandala.value(ID0, 17n, {
				lock: P2PKH_LOCK,
				payload: Uint8Array.from(bytes),
			}).lock()
			expect(s.toHex()).toBe(`20${hex(ID0_BYTES)}01116d${push}75${P2PKH_HEX}`)
			const d = Mandala.decode(s)
			expect(hex(d?.payload ?? [9])).toBe(hex(bytes))
			expect(d?.metadata).toBeUndefined()
			expect(d?.lock.toHex()).toBe(P2PKH_HEX)
		}
	})

	it('a value output with a DAG-CBOR payload exposes payloadMap but no metadata', () => {
		const s = Mandala.value(ID0, 17n, {
			lock: P2PKH_LOCK,
			payload: { sym: 'X' },
		}).lock()
		const d = Mandala.decode(s)
		expect(d?.payloadMap).toEqual({ sym: 'X' })
		expect(d?.metadata).toBeUndefined()
	})

	it('a non-map or non-strict payload has no payloadMap or metadata', () => {
		for (const p of [
			'83010203', // array, not a map
			'6158', // text, not a map
			'a26373796d6158', // truncated
			'a26373796d61586364656308', // keys out of order
			'bf6373796d6158ff', // indefinite-length map
			'a1636465631808', // non-minimal integer
			'b8016373796d6158', // non-minimal map length
			'a16373796dc16158', // tag 1
			'c1a16373796d6158', // tagged map, tag 1
			'a16373796df7', // undefined
		]) {
			const s = Mandala.deployAuthority({
				lock: P2PKH_LOCK,
				payload: Utils.toArray(p, 'hex'),
			}).lock()
			const d = Mandala.decode(s)
			expect(d?.role).toBe('deploy')
			expect(d?.payload).toBeDefined()
			expect(d?.payloadMap).toBeUndefined()
			expect(d?.metadata).toBeUndefined()
		}
	})

	it('malformed display fields are dropped, the deploy stays valid', () => {
		const payload = dagCborEncode({
			sym: 'OK',
			dec: 19,
			icon: Uint8Array.of(1, 2, 3),
		})
		const d = Mandala.decode(
			Mandala.deployAuthority({ lock: P2PKH_LOCK, payload }).lock(),
		)
		expect(d?.role).toBe('deploy')
		expect(d?.metadata).toEqual({ sym: 'OK' })
	})

	it('a <push> OP_DROP at the start of the lock is read as the payload', () => {
		const s = Script.fromHex(`00516d010275${P2PKH_HEX}`)
		const d = Mandala.decode(s)
		expect(hex(d?.payload ?? [])).toBe('02')
		expect(d?.lock.toHex()).toBe(P2PKH_HEX)
	})

	it('no payload and an inner lock starting with <push> OP_DROP: explicit empty payload', () => {
		// inner: <02> OP_DROP, then P2PKH
		const inner = LockingScript.fromHex(`010275${P2PKH_HEX}`)
		const t = Mandala.value(ID0, 17n, { lock: inner })
		expect(t.prefix().toHex()).toBe(`20${hex(ID0_BYTES)}01116d0075`)
		const d = Mandala.decode(t.lock())
		expect(d?.payload).toEqual(new Uint8Array(0))
		expect(d?.lock.toHex()).toBe(inner.toHex())
	})

	it('explicit empty payload for every push form before OP_DROP', () => {
		for (const push of ['00', '4f', '51', '60', '0102', '4c01ff']) {
			const inner = LockingScript.fromHex(`${push}75${P2PKH_HEX}`)
			const t = Mandala.deployAuthority({ lock: inner })
			expect(t.prefix().toHex()).toBe('00006d0075')
			const d = Mandala.decode(t.lock())
			expect(d?.payload).toEqual(new Uint8Array(0))
			expect(d?.lock.toHex()).toBe(inner.toHex())
		}
	})

	it('a given payload is written as-is before an inner <push> OP_DROP', () => {
		const inner = LockingScript.fromHex(`010275${P2PKH_HEX}`)
		const t = Mandala.value(ID0, 17n, {
			lock: inner,
			payload: Uint8Array.of(0xaa),
		})
		expect(t.prefix().toHex()).toBe(`20${hex(ID0_BYTES)}01116d01aa75`)
		const d = Mandala.decode(t.lock())
		expect(hex(d?.payload ?? [])).toBe('aa')
		expect(d?.lock.toHex()).toBe(inner.toHex())
	})

	it('no payload and a P2PKH inner lock: no payload written', () => {
		const t = Mandala.value(ID0, 17n, { lock: P2PKH_LOCK })
		expect(t.prefix().toHex()).toBe(`20${hex(ID0_BYTES)}01116d`)
		const d = Mandala.decode(t.lock())
		expect(d?.payload).toBeUndefined()
		expect(d?.lock.toHex()).toBe(P2PKH_HEX)
	})

	it('accepts a non-minimal payload push (matches the reference decoder)', () => {
		const d = Mandala.decode(Script.fromHex(`00516d4c010275${P2PKH_HEX}`))
		expect(hex(d?.payload ?? [])).toBe('02')
	})
})

describe('strict DAG-CBOR', () => {
	it('accepts the canonical forms', () => {
		expect(decodeDagCbor(Utils.toArray('a0', 'hex'))).toEqual({})
		expect(decodeDagCbor(Utils.toArray('a2616101616202', 'hex'))).toEqual({
			a: 1,
			b: 2,
		})
		expect(decodeDagCbor(Utils.toArray('a2616101626161f6', 'hex'))).toEqual({
			a: 1,
			aa: null,
		})
		expect(decodeDagCbor(Utils.toArray('fb3ff8000000000000', 'hex'))).toBe(1.5)
		// CIDv1, dag-cbor, sha2-256
		const cid = `01711220${'ab'.repeat(32)}`
		const link = decodeDagCbor(Utils.toArray(`d82a582500${cid}`, 'hex'))
		expect(link).toBeInstanceOf(DagCborLink)
		expect(hex((link as DagCborLink).cid)).toBe(cid)
		const nested = decodeDagCbor(
			Utils.toArray(`a1616cd82a582500${cid}`, 'hex'),
		) as Record<string, DagCborValue>
		expect(nested.l).toBeInstanceOf(DagCborLink)
	})
	it('encodes the spec examples byte for byte', () => {
		expect(hex(dagCborEncode({ sym: 'GOLD', dec: 8 }))).toBe(
			'a263646563086373796d64474f4c44',
		)
		expect(hex(dagCborEncode({ sym: 'STABLE', dec: 2 }))).toBe(
			'a263646563026373796d66535441424c45',
		)
	})
	const bad: [string, string][] = [
		['unsorted keys', 'a2616201616101'],
		['length-first violated', 'a2626161f6616101'],
		['duplicate keys', 'a2616101616102'],
		['non-text key', 'a10101'],
		['non-minimal int', '1801'],
		['non-minimal length', '7801' + '61'],
		['indefinite map', 'bf616101ff'],
		['undefined', 'f7'],
		['f16 float', 'f93e00'],
		['f32 float', 'fa3fc00000'],
		['NaN', 'fb7ff8000000000000'],
		['tag other than 42', 'c11a00000000'],
		['tag 42 without 0x00 prefix', `d82a5825${'01711220'}${'ab'.repeat(33)}`],
		['tag 42 holding a malformed CID', 'd82a4400017112'],
		['integral 64-bit float (JS cannot keep it a float)', 'fb3ff0000000000000'],
		['trailing bytes', 'a000'],
		['invalid UTF-8', '62c328'],
		['truncated', 'a161'],
	]
	for (const [name, h] of bad) {
		it(`rejects ${name}`, () => {
			expect(decodeDagCbor(Utils.toArray(h, 'hex'))).toBeUndefined()
		})
	}
})

describe('amm-poc fixtures', () => {
	it('token_deploy output 0: fixed-supply deploy of 10,000,000', () => {
		const tx = fixture('token_deploy')
		const out = tx.outputs[0].lockingScript
		const d = Mandala.decode(out)
		expect(d?.role).toBe('deploy')
		expect(d?.amount).toBe(10_000_000n)
		expect(d?.tokenId).toBeUndefined()
		expect(d?.payload).toBeUndefined()
		expect(d?.lock.toHex()).toBe(
			'76a9140ed3fb307701a6a39ed8ac47f8e0fc1858d19a5088ac',
		)
		// byte-exact rebuild
		expect(
			Mandala.deployValue(10_000_000n, { lock: d!.lock }).lock().toHex(),
		).toBe(out.toHex())
	})

	it('pool_deploy: value prefixes with the 32-byte id in front of the pool contract and P2PKHs', () => {
		const deployTx = fixture('token_deploy')
		const tokenId = `${deployTx.id('hex')}_0`
		const tx = fixture('pool_deploy')
		const expected: [number, bigint][] = [
			[0, 5_000_000n],
			[1, 50_000n],
			[2, 4_950_000n],
		]
		for (const [vout, amount] of expected) {
			const out = tx.outputs[vout].lockingScript
			const d = Mandala.decode(out)
			expect(d?.role).toBe('value')
			expect(d?.tokenId).toBe(tokenId)
			expect(hex(d?.idBytes ?? [])).toBe(
				hex(Utils.toArray(deployTx.id('hex'), 'hex').reverse()),
			)
			expect(d?.amount).toBe(amount)
			expect(d?.payload).toBeUndefined()
			expect(
				Mandala.value(tokenId, amount, { lock: d!.lock }).lock().toHex(),
			).toBe(out.toHex())
		}
		// the pool contract follows the prefix unchanged (OP_NOP OP_CODESEPARATOR ...)
		expect(
			Mandala.decode(tx.outputs[0].lockingScript)?.lock.toHex().slice(0, 4),
		).toBe('61ab')
		expect(Mandala.decode(tx.outputs[3].lockingScript)).toBeNull()
	})

	it('swap_tokens_in: amounts 150 (two-byte push) and 25', () => {
		const tokenId = `${fixture('token_deploy').id('hex')}_0`
		const tx = fixture('swap_tokens_in')
		const a = Mandala.decode(tx.outputs[2].lockingScript)
		const b = Mandala.decode(tx.outputs[3].lockingScript)
		expect([a?.tokenId, a?.amount]).toEqual([tokenId, 150n])
		expect([b?.tokenId, b?.amount]).toEqual([tokenId, 25n])
		expect(Mandala.decode(tx.outputs[0].lockingScript)?.role).toBe('value')
		expect(Mandala.decode(tx.outputs[1].lockingScript)).toBeNull()
	})

	it('legacy_migrate1: 36-byte id for a BRC-161 token deployed at output 1', () => {
		const deploy = fixture('legacy_deploy1')
		const tx = fixture('legacy_migrate1')
		const out = tx.outputs[0].lockingScript
		const d = Mandala.decode(out)
		const tokenId = `${deploy.id('hex')}_1`
		expect(d?.role).toBe('value')
		expect(d?.tokenId).toBe(tokenId)
		expect(d?.idBytes?.length).toBe(36)
		expect(d?.amount).toBe(500_000n)
		expect(
			Mandala.value(tokenId, 500_000n, { lock: d!.lock }).lock().toHex(),
		).toBe(out.toHex())
	})

	it('BRC-161 JSON inscriptions alone are not Mandala outputs', () => {
		for (const o of fixture('legacy_transfer').outputs) {
			expect(Mandala.decode(o.lockingScript)).toBeNull()
		}
	})
})

describe('binary wins over a BRC-161 inscription', () => {
	it('a Mandala prefix before a BSV-21 inscription decodes as Mandala', () => {
		const json = BSV21.transfer(`${'aa'.repeat(32)}_0`, 999n).lock(P2PKH_LOCK)
		const s = Mandala.value(ID0, 5000n, { lock: json }).lock()
		const d = Mandala.decode(s)
		expect(d?.role).toBe('value')
		expect(d?.tokenId).toBe(ID0)
		expect(d?.amount).toBe(5000n)
		// the inscription is just part of the lock
		expect(d?.lock.toHex()).toBe(json.toHex())
		expect(BSV21.decode(d!.lock)?.tokenData.amt).toBe('999')
	})
})

describe('Mandala.unlock', () => {
	it('signs a P2PKH inner lock and the spend verifies', async () => {
		const key = PrivateKey.fromRandom()
		const token = Mandala.value(ID0, 5000n, { lock: key.toAddress() })
		const source = new Transaction()
		source.addOutput({ satoshis: 1, lockingScript: token.lock() })
		const spend = new Transaction()
		spend.addInput({
			sourceTransaction: source,
			sourceOutputIndex: 0,
			unlockingScriptTemplate: token.unlock(key),
		})
		spend.addOutput({
			satoshis: 1,
			lockingScript: Mandala.value(ID0, 5000n, {
				lock: key.toAddress(),
			}).lock(),
		})
		await spend.sign()
		expect(spend.inputs[0].unlockingScript?.chunks.length).toBe(2)
		const v = new Spend({
			sourceTXID: source.id('hex'),
			sourceOutputIndex: 0,
			sourceSatoshis: 1,
			lockingScript: source.outputs[0].lockingScript,
			transactionVersion: spend.version,
			otherInputs: [],
			outputs: spend.outputs,
			inputIndex: 0,
			unlockingScript: spend.inputs[0].unlockingScript!,
			inputSequence: 0xffffffff,
			lockTime: spend.lockTime,
		})
		expect(v.validate()).toBe(true)
	})
})
