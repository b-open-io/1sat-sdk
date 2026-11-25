import { describe, expect, test } from 'bun:test'
import { Services } from '@bsv/wallet-toolbox-client'
import { applyBroadcastConfig } from '../src/broadcastConfig.js'

function postBeefProviders(options: Record<string, unknown>): string[] {
	const services = new Services(options as never) as unknown as {
		postBeefServices: { services: Array<{ name: string }> }
	}
	return services.postBeefServices.services.map((s) => s.name)
}

describe('applyBroadcastConfig', () => {
	const defaults = Services.createDefaultOptions('main') as unknown as Record<
		string,
		// biome-ignore lint/suspicious/noExplicitAny: toolbox options shape
		any
	>

	test('no config keeps the toolbox defaults', () => {
		const o = applyBroadcastConfig(defaults, undefined)
		expect(o).toEqual(defaults)
		expect(o).not.toBe(defaults)
		expect(postBeefProviders(o)).toEqual([
			'GorillaPoolArcBeef',
			'TaalArcBeef',
			'Bitails',
			'WhatsOnChain',
		])
	})

	test('arcadeUrl puts Arcade first; empty URLs remove the ARC providers', () => {
		const o = applyBroadcastConfig(defaults, {
			arcadeUrl: 'https://arcade.example',
			arcadeApiKey: 'k-arcade',
			arcGorillaPoolUrl: '',
			arcUrl: '',
		})
		expect(postBeefProviders(o)).toEqual([
			'ArcadeBeef',
			'Bitails',
			'WhatsOnChain',
		])
		expect(o.arcadeConfig.apiKey).toBe('k-arcade')
		expect(o.arcadeConfig.deploymentId).toBe(defaults.arcConfig.deploymentId)
	})

	test('API keys land in the toolbox option fields', () => {
		const o = applyBroadcastConfig(defaults, {
			arcApiKey: 'k-taal',
			arcGorillaPoolApiKey: 'k-gp',
			bitailsApiKey: 'k-bitails',
			whatsOnChainApiKey: 'k-woc',
		})
		expect(o.arcConfig.apiKey).toBe('k-taal')
		expect(o.arcGorillaPoolConfig.apiKey).toBe('k-gp')
		expect(o.bitailsApiKey).toBe('k-bitails')
		expect(o.whatsOnChainApiKey).toBe('k-woc')
		// Defaults are not changed in place.
		expect(defaults.arcConfig.apiKey).toBeUndefined()
	})

	test('custom ARC URLs replace the defaults', () => {
		const o = applyBroadcastConfig(defaults, {
			arcUrl: 'https://arc.example',
			arcGorillaPoolUrl: 'https://gp.example',
		})
		expect(o.arcUrl).toBe('https://arc.example')
		expect(o.arcGorillaPoolUrl).toBe('https://gp.example')
	})

	test('empty arcadeUrl clears an Arcade set earlier', () => {
		const withArcade = applyBroadcastConfig(defaults, {
			arcadeUrl: 'https://arcade.example',
		})
		const o = applyBroadcastConfig(withArcade, { arcadeUrl: '' })
		expect(o.arcadeUrl).toBeUndefined()
		expect(postBeefProviders(o)[0]).toBe('GorillaPoolArcBeef')
	})
})
