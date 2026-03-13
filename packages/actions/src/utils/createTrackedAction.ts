import {
	type CreateActionArgs,
	type CreateActionResult,
	Utils,
	type WalletInterface,
} from '@bsv/sdk'

/**
 * Generate a random hex string for action tracking.
 */
export function randomActionId(): string {
	const bytes = new Uint8Array(8)
	crypto.getRandomValues(bytes)
	return Utils.toHex(Array.from(bytes))
}

/**
 * Wrapper around wallet.createAction that injects an `id:<hex>` tag
 * into every output that has a basket. All outputs in the same action
 * share the same ID, allowing targeted lookups via listOutputs tag filter.
 *
 * @param wallet - BRC-100 wallet
 * @param args - Standard createAction args
 * @returns The createAction result, plus the generated actionId
 */
export async function createTrackedAction(
	wallet: WalletInterface,
	args: CreateActionArgs,
): Promise<CreateActionResult & { actionId: string }> {
	const actionId = randomActionId()
	const tag = `id:${actionId}`

	if (args.outputs) {
		for (const output of args.outputs) {
			if (output.basket) {
				output.tags = [...(output.tags ?? []), tag]
			}
		}
	}

	const result = await wallet.createAction(args)
	return { ...result, actionId }
}
