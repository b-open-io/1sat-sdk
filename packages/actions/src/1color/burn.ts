/**
 * 1Color (BRC-162) burn through the wallet's BRC-207 `color` module.
 *
 * BRC-162 burns implicitly: a transaction whose value inputs exceed its value
 * outputs destroys the difference. So this action names the inputs it spends,
 * which is also what the module requires — it selects no value inputs and adds
 * no change for a burn:
 *
 * 1. List the asset's value basket, take the largest outputs until they cover
 *    `amount` (the module's own order), skipping outputs it could not spend.
 * 2. When they overshoot, one value output of the remainder, locked to a fresh
 *    `p color` key of this wallet and declared in `plan.ownedOutputs`; when
 *    they cover it exactly, no token output at all, and the transaction burns
 *    everything it spends.
 * 3. One `createAction` with those explicit inputs, their source transactions
 *    in `inputBEEF` (an input the app names is the app's to fund), the plan
 *    declaring `burn` — plus `transfer` when there is a remainder, because
 *    BRC-207 derives both from one transaction — and `randomizeOutputs: false`.
 *
 * What the burn takes off the circulating supply is exactly `amount`; the fee
 * in satoshis is the wallet's, and any satoshi change is the wallet's.
 */

import { OneColor } from '@1sat/templates'
import type { CreateActionInput, CreateActionOutput } from '@bsv/sdk'
import type { Action } from '../types.js'
import { colorRemittance, newColorCustody, selfColorLock } from './custody.js'
import { listColorHoldings, sourceBeef } from './listing.js'
import { INVALID_ASSET_ID, colorPlanLabels, isColorAssetId } from './plan.js'

/** BRC-207 token inputs sign with P2PKH; the module sizes them the same way. */
const TOKEN_INPUT_UNLOCK_LENGTH = 108

export interface Burn1ColorInput {
	/** The asset id, `<txid>_<vout>` */
	assetId: string
	/** Units to take out of circulation, in raw units */
	amount: bigint | string
}

export interface Burn1ColorResult {
	txid?: string
	/** AtomicBEEF of the burn */
	tx?: number[]
	assetId?: string
	/** Units destroyed, as a string for JSON */
	burned?: string
	/** Units returned to this wallet because the inputs overshot, as a string */
	remainder?: string
	error?: string
}

/** Largest first, until `amount` is covered: the module's own selection order. */
function chooseForBurn(
	holds: { outpoint: string; amount: bigint }[],
	amount: bigint,
): { chosen: { outpoint: string; amount: bigint }[]; covered: bigint } {
	const sorted = [...holds].sort((a, b) =>
		a.amount < b.amount ? 1 : a.amount > b.amount ? -1 : 0,
	)
	const chosen: { outpoint: string; amount: bigint }[] = []
	let covered = 0n
	for (const hold of sorted) {
		if (covered >= amount) break
		chosen.push(hold)
		covered += hold.amount
	}
	return { chosen, covered }
}

export const burn1Color: Action<Burn1ColorInput, Burn1ColorResult> = {
	meta: {
		name: 'burn1Color',
		description:
			"Burn 1Color (BRC-162) tokens through the wallet's BRC-207 color module: spends this wallet's value outputs covering `amount` with no output for the difference, which is what destroys them",
		category: 'tokens',
		inputSchema: {
			type: 'object',
			properties: {
				assetId: {
					type: 'string',
					description: 'The asset id, <txid>_<vout>',
				},
				amount: {
					type: 'string',
					description: 'Units to destroy (string for bigint)',
				},
			},
			required: ['assetId', 'amount'],
		},
	},

	async execute(ctx, input) {
		try {
			const { assetId } = input
			if (!isColorAssetId(assetId)) return { error: INVALID_ASSET_ID }
			const amount = BigInt(input.amount)
			if (amount <= 0n) return { error: 'amount-must-be-positive' }

			const listing = await listColorHoldings(ctx, assetId, 'value', {
				sources: true,
			})
			const available = listing.outputs.filter(
				(hold) => hold.spendable && hold.spendableThroughModule,
			)
			const { chosen, covered } = chooseForBurn(available, amount)
			if (covered < amount) {
				return {
					error: `insufficient-value-balance: ${covered} spendable of ${amount}`,
				}
			}

			const inputs: CreateActionInput[] = chosen.map((hold) => ({
				outpoint: hold.outpoint,
				unlockingScriptLength: TOKEN_INPUT_UNLOCK_LENGTH,
				inputDescription: '1Color tokens to burn',
			}))

			// What the inputs carry beyond the burn comes back to us as one output.
			const remainder = covered - amount
			const outputs: CreateActionOutput[] = []
			const ownedOutputs = []
			if (remainder > 0n) {
				const custody = await newColorCustody(ctx, assetId)
				outputs.push({
					lockingScript: OneColor.value(assetId, remainder, {
						lock: await selfColorLock(ctx, custody),
					})
						.lock()
						.toHex(),
					satoshis: 1,
					outputDescription: '1Color token change',
				})
				ownedOutputs.push(colorRemittance(0, custody))
			}

			const created = await ctx.wallet.createAction({
				description: `Burn ${amount} 1Color tokens`,
				inputs,
				outputs,
				inputBEEF: sourceBeef(
					listing,
					chosen.map((hold) => hold.outpoint),
				),
				labels: colorPlanLabels({
					assetId,
					operations: remainder > 0n ? ['transfer', 'burn'] : ['burn'],
					ownedOutputs,
				}),
				options: { randomizeOutputs: false },
			})
			if (!created.txid || !created.tx) return { error: 'no-transaction' }
			return {
				txid: created.txid,
				tx: Array.from(created.tx),
				assetId,
				burned: amount.toString(),
				remainder: remainder.toString(),
			}
		} catch (error) {
			return {
				error: error instanceof Error ? error.message : String(error),
			}
		}
	},
}
