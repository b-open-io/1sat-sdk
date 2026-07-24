import type { BEEF, WalletInterface, WalletOutput } from '@bsv/sdk'

/** Accept bare id value or full `id:…` tag. */
export function toIdTag(id: string): string {
	const t = id.trim()
	if (!t) throw new Error('empty-id')
	return t.startsWith('id:') ? t : `id:${t}`
}

export interface LoadBasketOutputResult {
	output: WalletOutput
	/** Present when includeBeef is true */
	BEEF?: BEEF
}

/**
 * Load a single wallet-owned basket UTXO by tracking id.
 * Returns tags, customInstructions, outpoint; optionally BEEF for spending.
 */
export async function loadBasketOutput(
	wallet: WalletInterface,
	basket: string,
	id: string,
	opts?: { includeBeef?: boolean },
): Promise<LoadBasketOutputResult | { error: string }> {
	let idTag: string
	try {
		idTag = toIdTag(id)
	} catch {
		return { error: 'empty-id' }
	}

	const result = await wallet.listOutputs({
		basket,
		tags: [idTag],
		tagQueryMode: 'all',
		includeTags: true,
		includeCustomInstructions: true,
		...(opts?.includeBeef ? { include: 'entire transactions' as const } : {}),
		limit: 1,
	})

	const output = result.outputs[0]
	if (!output) {
		return { error: `output-not-found:${idTag}` }
	}

	return {
		output,
		...(opts?.includeBeef && result.BEEF ? { BEEF: result.BEEF } : {}),
	}
}

/** BEEF bytes for a loaded row, or error. */
export async function loadBasketOutputBeef(
	wallet: WalletInterface,
	basket: string,
	id: string,
): Promise<{ output: WalletOutput; beef: number[] } | { error: string }> {
	const loaded = await loadBasketOutput(wallet, basket, id, {
		includeBeef: true,
	})
	if ('error' in loaded) return loaded
	if (!loaded.BEEF?.length) {
		return { error: `no-beef:${toIdTag(id)}` }
	}
	return { output: loaded.output, beef: Array.from(loaded.BEEF) }
}
