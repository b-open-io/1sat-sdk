import type { WalletInterface, WalletOutput } from '@bsv/sdk'

/**
 * Extract the `id:<hex>` tag from a WalletOutput's tags array.
 */
export function extractIdTag(
	output: Pick<WalletOutput, 'tags'>,
): string | undefined {
	return output.tags?.find((t) => t.startsWith('id:'))
}

/**
 * Resolve BEEF for a wallet output by looking it up via its ID tag.
 *
 * Actions attach an `id:<hex>` tag to every basketed output via createTrackedAction.
 * This helper uses that tag to call listOutputs with `include: 'entire transactions'`
 * and returns the BEEF bytes.
 *
 * @param wallet - BRC-100 wallet
 * @param basket - Basket name the output lives in (e.g. '1sat', 'lock', 'default')
 * @param output - The output whose BEEF we need (must have an `id:` tag)
 * @returns BEEF byte array
 * @throws If the output has no ID tag or the lookup returns no results
 */
export async function resolveBeef(
	wallet: WalletInterface,
	basket: string,
	output: Pick<WalletOutput, 'tags'>,
): Promise<number[]> {
	const idTag = extractIdTag(output)
	if (!idTag) {
		throw new Error(
			'Output has no id: tag — inputBEEF must be provided explicitly',
		)
	}

	const result = await wallet.listOutputs({
		basket,
		tags: [idTag],
		include: 'entire transactions',
		limit: 1,
	})

	if (!result.BEEF || result.BEEF.length === 0) {
		throw new Error(`No BEEF returned for tag ${idTag} in basket "${basket}"`)
	}

	return Array.from(result.BEEF)
}
