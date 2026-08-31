import { describe, expect, test } from 'bun:test'
import type { Txo } from '@1sat/types'
import { P1SAT_PROTOCOL } from '../src/constants'
import {
	type OutputDerivation,
	buildInternalizeOutput,
} from '../src/utils/internalizeBeef'

describe('ordinal counterparty delivery', () => {
	test('keeps the exact transfer key when preparing recipient wallet metadata', () => {
		const keyID = `${'a'.repeat(64)}.0`
		const senderIdentityKey = `02${'b'.repeat(64)}`
		const txo = {
			basket: '1sat',
			data: {
				origin: {
					data: {},
					tags: [`origin:${'c'.repeat(64)}_0`, 'type:application/x-bitplan'],
				},
			},
			outpoint: { vout: 0 },
		} as unknown as Txo
		const derivation: OutputDerivation = {
			counterparty: senderIdentityKey,
			keyID,
			outputIndex: 0,
			protocolID: P1SAT_PROTOCOL,
			senderIdentityKey,
		}

		const output = buildInternalizeOutput(txo, derivation, 'delivery')
		if (!output || output.protocol !== 'basket insertion') {
			throw new Error('Expected a basket insertion')
		}
		const instructions = JSON.parse(
			output.insertionRemittance.customInstructions ?? '{}',
		)

		expect(output.insertionRemittance.basket).toBe('1sat')
		expect(output.insertionRemittance.tags).toContain(
			'type:application/x-bitplan',
		)
		expect(instructions).toMatchObject({
			counterparty: senderIdentityKey,
			keyID,
			protocolID: P1SAT_PROTOCOL,
		})
	})
})
