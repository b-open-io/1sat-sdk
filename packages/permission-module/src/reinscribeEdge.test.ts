import { describe, expect, it } from 'bun:test'
import { buildInscriptionScript } from '@1sat/templates'
import { ORDINALS_BASKET, buildInputAssetLabel } from '@1sat/types'
import {
	P2PKH,
	PrivateKey,
	type WalletInterface,
	type WalletOutput,
} from '@bsv/sdk'
import { buildTransactionPrompt } from './buildPromptIntent'
import { enrichIntent } from './enrichIntent'

const TXID = 'a'.repeat(64)
const OUTPOINT = `${TXID}.0`
const ORIGIN = `${TXID}_0`
const ID = 'abc'

function mockWallet(ordinal: WalletOutput): WalletInterface {
	return {
		listOutputs: async () => ({
			outputs: [ordinal],
			totalOutputs: 1,
		}),
	} as unknown as WalletInterface
}

describe('reinscribe ordinal edge', () => {
	it('classifies spend + new envelope as reinscribe with prior + new preview', async () => {
		const address = PrivateKey.fromRandom().toPublicKey().toAddress()
		const body = new TextEncoder().encode('revision two')
		const lockingScript = buildInscriptionScript(
			new P2PKH().lock(address),
			body,
			'text/plain',
		).toHex()

		const ordinal: WalletOutput = {
			outpoint: OUTPOINT,
			satoshis: 1,
			spendable: true,
			tags: ['id:abc', 'type:text/plain', `origin:${ORIGIN}`],
		}

		const enriched = await enrichIntent(mockWallet(ordinal), {
			description: 'Transfer ordinal',
			labels: [buildInputAssetLabel(ORDINALS_BASKET, ID)],
			outputs: [
				{
					lockingScript,
					satoshis: 1,
					basket: ORDINALS_BASKET,
					tags: [`origin:${ORIGIN}`, 'type:text/plain'],
				},
			],
		})

		expect(enriched.ordinalEdges).toHaveLength(1)
		expect(enriched.ordinalEdges[0].operation).toBe('reinscribe')
		expect(enriched.ordinalEdges[0].create?.inscriptionText).toContain(
			'revision two',
		)

		const originUrl = `https://ordfs.example/${ORIGIN}`
		const prompt = buildTransactionPrompt(enriched, { [ORIGIN]: originUrl }, 'app.example')
		expect(prompt.panels[0].title).toBe('Reinscribe')
		expect(prompt.panels[0].previewText).toContain('revision two')
		expect(prompt.panels[0].prior?.contentUrl).toBe(originUrl)
	})

	it('keeps a plain transfer as transfer with no prior', async () => {
		const address = PrivateKey.fromRandom().toPublicKey().toAddress()
		const ordinal: WalletOutput = {
			outpoint: OUTPOINT,
			satoshis: 1,
			spendable: true,
			tags: ['id:abc', `origin:${ORIGIN}`],
		}

		const enriched = await enrichIntent(mockWallet(ordinal), {
			description: 'Transfer ordinal',
			labels: [buildInputAssetLabel(ORDINALS_BASKET, ID)],
			outputs: [
				{
					lockingScript: new P2PKH().lock(address).toHex(),
					satoshis: 1,
					basket: ORDINALS_BASKET,
					tags: [`origin:${ORIGIN}`],
				},
			],
		})

		expect(enriched.ordinalEdges[0].operation).toBe('transfer')
		const prompt = buildTransactionPrompt(enriched, {}, 'app.example')
		expect(prompt.panels[0].title).toBe('Move')
		expect(prompt.panels[0].prior).toBeUndefined()
	})
})
