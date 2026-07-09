import { describe, expect, it } from 'bun:test'
import { Hash, Script, Utils } from '@bsv/sdk'
import Inscription from '../inscription/inscription.js'
import {
	SHRUG_METADATA_CONTENT_TYPE,
	decodeShrugMetadata,
	encodeShrugMetadata,
} from './metadata.js'
import Shrug, { SHRUG_TAG_HEX } from './shrug.js'

// Golden vectors shared with the Go implementation
// (go-templates/template/shrug tests).
const GOLDEN_PREFIX_HEX = [
	'0dc2af5c5f28e38384295f2fc2af',
	'24000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f01000000',
	'6d',
	'028813',
	'75',
].join('')
const GOLDEN_ID =
	'1f1e1d1c1b1a191817161514131211100f0e0d0c0b0a09080706050403020100_1'

const GOLDEN_METADATA_HEX = [
	'a3', // map(3), RFC 8949 deterministic key order
	'6364656308', // "dec": 8
	'6373796d64474f4c44', // "sym": "GOLD"
	'6469636f6e5824', // "icon": 36-byte outpoint
	'11'.repeat(32),
	'01000000',
].join('')
const GOLDEN_ICON = `${'1'.repeat(64)}_1`

const P2PKH_SUFFIX = Script.fromHex(`76a914${'ab'.repeat(20)}88ac`)

describe('Shrug prefix', () => {
	it('lock matches the Go golden vector', () => {
		const script = new Shrug({ id: GOLDEN_ID, amount: 5000n }).lock()
		expect(Utils.toHex(script.toBinary())).toBe(GOLDEN_PREFIX_HEX)
	})

	it('decodes the Go golden vector', () => {
		const decoded = Shrug.decode(Script.fromHex(GOLDEN_PREFIX_HEX))
		expect(decoded).not.toBeNull()
		expect(decoded?.id).toBe(GOLDEN_ID)
		expect(decoded?.amount).toBe(5000n)
		expect(decoded?.scriptSuffix.length).toBe(0)
	})

	const roundTrips: [string, { id?: string; amount?: bigint }][] = [
		['deploy with supply', { amount: 21_000_000n }],
		['deploy authority', {}],
		['authority', { id: GOLDEN_ID }],
		['value', { id: GOLDEN_ID, amount: 5000n }],
		['amount 1', { id: GOLDEN_ID, amount: 1n }],
		['max uint64', { id: GOLDEN_ID, amount: 0xffffffffffffffffn }],
		['beyond uint64', { id: GOLDEN_ID, amount: 1n << 128n }],
	]

	for (const [name, token] of roundTrips) {
		it(`round-trips ${name}`, () => {
			const script = new Shrug(token).lock(P2PKH_SUFFIX)
			const decoded = Shrug.decode(script)
			expect(decoded).not.toBeNull()
			expect(decoded?.id).toBe(token.id)
			expect(decoded?.amount).toBe(token.amount ?? 0n)
			expect(Utils.toHex(decoded?.scriptSuffix ?? [])).toBe(
				Utils.toHex(P2PKH_SUFFIX.toBinary()),
			)
		})
	}

	it('rejects wrong tag', () => {
		const script = new Script([
			{ op: 9, data: Utils.toArray('notashrug', 'utf8') },
			{ op: 0 },
			{ op: 0x6d },
			{ op: 0 },
			{ op: 0x75 },
		])
		expect(Shrug.decode(script)).toBeNull()
	})

	it('rejects negative amount', () => {
		const script = new Script([
			{ op: 13, data: Utils.toArray(SHRUG_TAG_HEX, 'hex') },
			{ op: 0 },
			{ op: 0x6d },
			{ op: 1, data: [0x81] }, // -1
			{ op: 0x75 },
		])
		expect(Shrug.decode(script)).toBeNull()
	})

	it('rejects non-minimal amount', () => {
		const script = new Script([
			{ op: 13, data: Utils.toArray(SHRUG_TAG_HEX, 'hex') },
			{ op: 0 },
			{ op: 0x6d },
			{ op: 3, data: [0x88, 0x13, 0x00] }, // 5000 with trailing zero
			{ op: 0x75 },
		])
		expect(Shrug.decode(script)).toBeNull()
	})

	it('rejects id of wrong length', () => {
		const script = new Script([
			{ op: 13, data: Utils.toArray(SHRUG_TAG_HEX, 'hex') },
			{ op: 35, data: new Array(35).fill(0x11) },
			{ op: 0x6d },
			{ op: 1, data: [0x01] },
			{ op: 0x75 },
		])
		expect(Shrug.decode(script)).toBeNull()
	})
})

describe('Shrug metadata', () => {
	it('encodes the Go golden vector', () => {
		const encoded = encodeShrugMetadata({
			sym: 'GOLD',
			icon: GOLDEN_ICON,
			dec: 8,
		})
		expect(Utils.toHex(encoded)).toBe(GOLDEN_METADATA_HEX)
	})

	it('decodes the Go golden vector', () => {
		const decoded = decodeShrugMetadata(
			Utils.toArray(GOLDEN_METADATA_HEX, 'hex'),
		)
		expect(decoded).not.toBeNull()
		expect(decoded?.sym).toBe('GOLD')
		expect(decoded?.dec).toBe(8)
		expect(decoded?.icon).toBe(GOLDEN_ICON)
	})

	it('encodes the empty document', () => {
		expect(Utils.toHex(encodeShrugMetadata({}))).toBe('a0')
	})

	it('ignores unknown keys', () => {
		// {"dec": 2, "foo": 1}
		const decoded = decodeShrugMetadata(
			Utils.toArray('a2636465630263666f6f01', 'hex'),
		)
		expect(decoded).not.toBeNull()
		expect(decoded?.dec).toBe(2)
	})

	it('rejects out-of-range dec', () => {
		// {"dec": 19}
		expect(decodeShrugMetadata(Utils.toArray('a16364656313', 'hex'))).toBeNull()
		expect(() => encodeShrugMetadata({ dec: 19 })).toThrow()
	})

	it('rejects wrong icon length', () => {
		// {"icon": h'11223344'}
		expect(
			decodeShrugMetadata(Utils.toArray('a16469636f6e4411223344', 'hex')),
		).toBeNull()
	})
})

describe('Shrug composition', () => {
	it('populates metadata from a suffix inscription', () => {
		const content = new Uint8Array(
			encodeShrugMetadata({ sym: 'GOLD', icon: GOLDEN_ICON, dec: 8 }),
		)
		const envelope = new Inscription({
			type: SHRUG_METADATA_CONTENT_TYPE,
			content,
			size: content.length,
			hash: new Uint8Array(Hash.sha256(Array.from(content))),
		}).lock()

		const suffix = new Script([...envelope.chunks, ...P2PKH_SUFFIX.chunks])
		const decoded = Shrug.decode(
			new Shrug({ amount: 21_000_000n }).lock(suffix),
		)

		expect(decoded).not.toBeNull()
		expect(decoded?.insc).toBeDefined()
		expect(decoded?.metadata?.sym).toBe('GOLD')
		expect(decoded?.metadata?.dec).toBe(8)
		expect(decoded?.metadata?.icon).toBe(GOLDEN_ICON)
	})

	it('surfaces non-metadata inscriptions without metadata', () => {
		const content = new Uint8Array(Utils.toArray('hello', 'utf8'))
		const envelope = new Inscription({
			type: 'text/plain',
			content,
			size: content.length,
			hash: new Uint8Array(Hash.sha256(Array.from(content))),
		}).lock()

		const decoded = Shrug.decode(
			new Shrug({ id: GOLDEN_ID, amount: 1n }).lock(envelope),
		)

		expect(decoded).not.toBeNull()
		expect(decoded?.insc?.file.type).toBe('text/plain')
		expect(decoded?.metadata).toBeUndefined()
	})
})
