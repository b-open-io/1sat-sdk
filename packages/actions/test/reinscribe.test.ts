import { describe, expect, it } from 'bun:test'
import { Inscription, MAP as MAPTemplate } from '@1sat/templates'
import {
	LockingScript,
	P2PKH,
	PrivateKey,
	Script,
	Utils,
	type WalletInterface,
	type WalletOutput,
} from '@bsv/sdk'
import { MAX_INSCRIPTION_BYTES, ORDINALS_BASKET } from '../src/constants'
import { buildTransferOrdinals } from '../src/ordinals/index'
import type { OneSatContext } from '../src/types'

// ============================================================================
// Fixtures — pure script-building tests, no network.
// ============================================================================

const SOURCE_TXID = 'a'.repeat(64)
const SOURCE_OUTPOINT = `${SOURCE_TXID}.0`
// ordinalSeedTags normalizes origin outpoints to underscore form (BRC-147).
const SOURCE_ORIGIN_TAG = `origin:${SOURCE_TXID}_0`
const FAKE_BEEF = [1, 2, 3]

const recipientAddress = PrivateKey.fromRandom().toPublicKey().toAddress()
const selfPubKeyHex = PrivateKey.fromRandom().toPublicKey().toString()

const content = new TextEncoder().encode('hello reinscribed world')
const base64Content = Utils.toBase64(Array.from(content))
const contentType = 'text/plain'

function makeOrdinal(tags: string[]): WalletOutput {
	return {
		outpoint: SOURCE_OUTPOINT,
		satoshis: 1,
		spendable: true,
		tags,
		customInstructions: JSON.stringify({
			protocolID: [0, '1sat'],
			keyID: SOURCE_OUTPOINT,
		}),
	}
}

function makeCtx(ordinal: WalletOutput): OneSatContext {
	const wallet: Partial<WalletInterface> = {
		listOutputs: async () => ({
			outputs: [ordinal],
			BEEF: FAKE_BEEF,
			totalOutputs: 1,
		}),
		getPublicKey: async () => ({ publicKey: selfPubKeyHex }),
	}
	return {
		wallet: wallet as WalletInterface,
		chain: 'main',
		isBaseWallet: true,
	}
}

// ============================================================================
// Tests
// ============================================================================

describe('buildTransferOrdinals — reinscription', () => {
	it('produces a script Inscription.decode parses back to the exact content and contentType', async () => {
		const ordinal = makeOrdinal([
			'type:application/json',
			`origin:${SOURCE_OUTPOINT}`,
		])
		const result = await buildTransferOrdinals(makeCtx(ordinal), {
			transfers: [
				{
					id: 'abc',
					address: recipientAddress,
					inscription: { base64Content, contentType },
				},
			],
		})
		if ('error' in result) throw new Error(result.error)

		const script = Script.fromHex(result.outputs?.[0]?.lockingScript as string)
		const decoded = Inscription.decode(script)
		expect(decoded).not.toBeNull()
		expect(decoded?.file.type).toBe(contentType)
		expect(Array.from(decoded?.file.content ?? [])).toEqual(Array.from(content))
	})

	it('keeps the recipient P2PKH lock and appended MAP in the script suffix', async () => {
		const ordinal = makeOrdinal([
			'type:application/json',
			`origin:${SOURCE_OUTPOINT}`,
		])
		const map = { app: '1sat-sdk-test', op: 'reinscribe' }
		const result = await buildTransferOrdinals(makeCtx(ordinal), {
			transfers: [
				{
					id: 'abc',
					address: recipientAddress,
					inscription: { base64Content, contentType },
					map,
				},
			],
		})
		if ('error' in result) throw new Error(result.error)

		const script = Script.fromHex(result.outputs?.[0]?.lockingScript as string)
		const decoded = Inscription.decode(script)
		expect(decoded?.scriptSuffix).toBeDefined()

		const expectedP2pkh = new P2PKH().lock(recipientAddress)
		const expectedMap = MAPTemplate.set(map)
		const expectedSuffix = new Script()
		for (const chunk of expectedP2pkh.chunks) expectedSuffix.chunks.push(chunk)
		for (const chunk of expectedMap.chunks) expectedSuffix.chunks.push(chunk)

		expect(decoded?.scriptSuffix?.toHex()).toBe(expectedSuffix.toHex())
	})

	it('no-inscription transfer with MAP is byte-identical to the previous P2PKH+MAP composition', async () => {
		const ordinal = makeOrdinal([
			'type:application/json',
			`origin:${SOURCE_OUTPOINT}`,
		])
		const map = { app: '1sat-sdk-test' }
		const result = await buildTransferOrdinals(makeCtx(ordinal), {
			transfers: [{ id: 'abc', address: recipientAddress, map }],
		})
		if ('error' in result) throw new Error(result.error)

		const p2pkhScript = new P2PKH().lock(recipientAddress)
		const mapScript = MAPTemplate.set(map)
		const combined = new Script()
		for (const chunk of p2pkhScript.chunks) combined.chunks.push(chunk)
		for (const chunk of mapScript.chunks) combined.chunks.push(chunk)

		expect(result.outputs?.[0]?.lockingScript).toBe(
			new LockingScript(combined.chunks).toHex(),
		)
	})

	it('no-inscription, no-map transfer is byte-identical to a plain P2PKH lock', async () => {
		const ordinal = makeOrdinal([
			'type:application/json',
			`origin:${SOURCE_OUTPOINT}`,
		])
		const result = await buildTransferOrdinals(makeCtx(ordinal), {
			transfers: [{ id: 'abc', address: recipientAddress }],
		})
		if ('error' in result) throw new Error(result.error)

		expect(result.outputs?.[0]?.lockingScript).toBe(
			new P2PKH().lock(recipientAddress).toHex(),
		)
	})

	it('rejects empty inscription content', async () => {
		const ordinal = makeOrdinal([
			'type:application/json',
			`origin:${SOURCE_OUTPOINT}`,
		])
		const result = await buildTransferOrdinals(makeCtx(ordinal), {
			transfers: [
				{
					id: 'abc',
					address: recipientAddress,
					inscription: { base64Content: '', contentType },
				},
			],
		})
		expect('error' in result && result.error).toBe('inscription-content-empty')
	})

	it('rejects malformed base64 content without throwing', async () => {
		const ordinal = makeOrdinal([
			'type:application/json',
			`origin:${SOURCE_OUTPOINT}`,
		])
		const result = await buildTransferOrdinals(makeCtx(ordinal), {
			transfers: [
				{
					id: 'abc',
					address: recipientAddress,
					inscription: { base64Content: '!!!not base64!!!', contentType },
				},
			],
		})
		expect('error' in result && result.error).toBe(
			'inscription-content-invalid',
		)
	})

	it('rejects empty contentType without throwing', async () => {
		const ordinal = makeOrdinal([
			'type:application/json',
			`origin:${SOURCE_OUTPOINT}`,
		])
		const result = await buildTransferOrdinals(makeCtx(ordinal), {
			transfers: [
				{
					id: 'abc',
					address: recipientAddress,
					inscription: { base64Content, contentType: '' },
				},
			],
		})
		expect('error' in result && result.error).toBe(
			'inscription-content-type-invalid',
		)
	})

	it('rejects contentType over 255 characters without throwing', async () => {
		const ordinal = makeOrdinal([
			'type:application/json',
			`origin:${SOURCE_OUTPOINT}`,
		])
		const result = await buildTransferOrdinals(makeCtx(ordinal), {
			transfers: [
				{
					id: 'abc',
					address: recipientAddress,
					inscription: { base64Content, contentType: 'x'.repeat(300) },
				},
			],
		})
		expect('error' in result && result.error).toBe(
			'inscription-content-type-invalid',
		)
	})

	it('rejects content larger than MAX_INSCRIPTION_BYTES', async () => {
		const ordinal = makeOrdinal([
			'type:application/json',
			`origin:${SOURCE_OUTPOINT}`,
		])
		const oversized = new Uint8Array(MAX_INSCRIPTION_BYTES + 1)
		const oversizedBase64 = Utils.toBase64(Array.from(oversized))
		const result = await buildTransferOrdinals(makeCtx(ordinal), {
			transfers: [
				{
					id: 'abc',
					address: recipientAddress,
					inscription: { base64Content: oversizedBase64, contentType },
				},
			],
		})
		expect('error' in result && result.error).toBe('inscription-too-large')
	})

	it('self-spend: preserves origin, drops the stale type tag, adds the new type and sha256 tags', async () => {
		const ordinal = makeOrdinal([
			'type:application/json',
			`origin:${SOURCE_OUTPOINT}`,
			'name:old-doc',
		])
		const result = await buildTransferOrdinals(makeCtx(ordinal), {
			transfers: [
				{
					id: 'abc',
					counterparty: 'self',
					inscription: { base64Content, contentType },
				},
			],
		})
		if ('error' in result) throw new Error(result.error)

		const output = result.outputs?.[0]
		expect(output?.basket).toBe(ORDINALS_BASKET)
		const tags = output?.tags ?? []
		expect(tags).toContain(SOURCE_ORIGIN_TAG)
		expect(tags).toContain(`type:${contentType}`)
		expect(tags).not.toContain('type:application/json')
		expect(tags.some((t) => t.startsWith('sha256:'))).toBe(true)
		// ordinalSeedTags does not copy name: tags — display names live in
		// customInstructions (buildOrdinalCustomInstructions) on this path.
		expect(tags).not.toContain('name:old-doc')
	})

	it('self-spend without inscription keeps existing tag carry-over behavior unchanged', async () => {
		const ordinal = makeOrdinal([
			'type:application/json',
			`origin:${SOURCE_OUTPOINT}`,
			'name:old-doc',
		])
		const result = await buildTransferOrdinals(makeCtx(ordinal), {
			transfers: [{ id: 'abc', counterparty: 'self' }],
		})
		if ('error' in result) throw new Error(result.error)

		const tags = result.outputs?.[0]?.tags ?? []
		expect(tags).toEqual(['type:application/json', SOURCE_ORIGIN_TAG])
	})
})
