import { describe, expect, test } from 'bun:test'
import { Inscription } from '@1sat/templates'
import { OPNS_BASKET, ORDINALS_BASKET } from '@1sat/types'
import {
	Beef,
	P2PKH,
	PrivateKey,
	Transaction,
	UnlockingScript,
	Utils,
} from '@bsv/sdk'
import { internalizeOutpointBeef } from './internalizeOutpointBeef.js'
import { OUTPOINT_BEEF_PREFIX, parseOutpointBeef } from './outpointBeef.js'

/** Test-only envelope builder (egress is out of scope for the SDK). */
function wrapOutpointBeef(txid: string, vout: number, beef: Beef): number[] {
	const clean = txid.trim().toLowerCase()
	const body = beef.toBinary()
	const out = new Uint8Array(40 + body.length)
	out.set(OUTPOINT_BEEF_PREFIX as unknown as ArrayLike<number>, 0)
	for (let i = 0; i < 32; i++) {
		out[4 + i] = Number.parseInt(
			clean.slice((31 - i) * 2, (31 - i) * 2 + 2),
			16,
		)
	}
	out[36] = vout & 0xff
	out[37] = (vout >>> 8) & 0xff
	out[38] = (vout >>> 16) & 0xff
	out[39] = (vout >>> 24) & 0xff
	out.set(body, 40)
	return Array.from(out)
}

function mintTx(contentType: string): Transaction {
	const insc = Inscription.create(
		new Uint8Array(Utils.toArray('art', 'utf8')),
		contentType,
	)
	const tx = new Transaction()
	tx.addOutput({ lockingScript: insc.lock(), satoshis: 1 })
	return tx
}

function transferTx(sourceTxid: string): Transaction {
	const addr = PrivateKey.fromRandom().toPublicKey().toAddress()
	const tx = new Transaction()
	tx.addInput({
		sourceTXID: sourceTxid,
		sourceOutputIndex: 0,
		unlockingScript: new UnlockingScript(),
		sequence: 0xffffffff,
	})
	tx.addOutput({ lockingScript: new P2PKH().lock(addr), satoshis: 1 })
	return tx
}

function mockWallet(calls: Array<Record<string, unknown>>) {
	return {
		internalizeAction: async (args: Record<string, unknown>) => {
			calls.push(args)
			return { accepted: true as const }
		},
	}
}

describe('parseOutpointBeef', () => {
	test('parses subject + body', () => {
		const mint = mintTx('text/plain')
		const mintId = mint.id('hex')
		const beef = new Beef()
		beef.mergeRawTx(mint.toBinary())
		const env = wrapOutpointBeef(mintId, 0, beef)
		expect(env.slice(0, 4)).toEqual([0x16, 0xa7, 0xbe, 0xef])
		const parsed = parseOutpointBeef(env)
		expect(parsed.txid).toBe(mintId.toLowerCase())
		expect(parsed.vout).toBe(0)
		expect(parsed.beef.findTxid(mintId)?.tx?.id('hex')).toBe(mintId)
	})

	test('rejects bad prefix', () => {
		expect(() => parseOutpointBeef(new Uint8Array(40))).toThrow()
	})
})

describe('internalizeOutpointBeef', () => {
	test('mint files bare origin tag in 1sat basket', async () => {
		const mint = mintTx('image/png')
		const mintId = mint.id('hex').toLowerCase()
		const beef = new Beef()
		beef.mergeRawTx(mint.toBinary())
		const calls: Array<Record<string, unknown>> = []

		const res = await internalizeOutpointBeef(
			mockWallet(calls) as never,
			wrapOutpointBeef(mintId, 0, beef),
			{ protocolID: [0, 'onesat'], keyID: 'k', counterparty: 'self' },
			'test recv',
		)
		expect(res.basket).toBe(ORDINALS_BASKET)
		expect(res.origin).toBe(`${mintId}_0`)
		expect(res.tags).toContain('origin')
		expect(res.tags).toContain('type:image/png')
		expect(calls.length).toBe(1)
	})

	test('transfer resolves origin and routes by origin type', async () => {
		const mint = mintTx('text/plain')
		const mintId = mint.id('hex').toLowerCase()
		const tip = transferTx(mintId)
		const tipId = tip.id('hex').toLowerCase()
		const beef = new Beef()
		beef.mergeRawTx(tip.toBinary())
		beef.mergeRawTx(mint.toBinary())
		const calls: Array<Record<string, unknown>> = []

		const res = await internalizeOutpointBeef(
			mockWallet(calls) as never,
			wrapOutpointBeef(tipId, 0, beef),
			{ protocolID: [0, 'onesat'], keyID: 'k' },
		)
		expect(res.basket).toBe(ORDINALS_BASKET)
		expect(res.origin).toBe(`${mintId}_0`)
		expect(res.tags).toContain(`origin:${mintId}_0`)
		expect(res.tags).toContain('type:text/plain')
		expect(calls.length).toBe(1)
	})

	test('op-ns origin routes to opns basket', async () => {
		const mint = mintTx('application/op-ns')
		const mintId = mint.id('hex').toLowerCase()
		const beef = new Beef()
		beef.mergeRawTx(mint.toBinary())
		const calls: Array<Record<string, unknown>> = []

		const res = await internalizeOutpointBeef(
			mockWallet(calls) as never,
			wrapOutpointBeef(mintId, 0, beef),
			{ protocolID: [0, 'onesat'], keyID: 'k' },
		)
		expect(res.basket).toBe(OPNS_BASKET)
	})

	test('fails closed when a parent is missing', async () => {
		const tip = transferTx('f'.repeat(64))
		const tipId = tip.id('hex').toLowerCase()
		const beef = new Beef()
		beef.mergeRawTx(tip.toBinary())
		const calls: Array<Record<string, unknown>> = []

		await expect(
			internalizeOutpointBeef(
				mockWallet(calls) as never,
				wrapOutpointBeef(tipId, 0, beef),
				{ protocolID: [0, 'onesat'], keyID: 'k' },
			),
		).rejects.toThrow()
		expect(calls.length).toBe(0)
	})
})
