/**
 * sweepDeposit — rotate plain BSV out of the user's P1SAT-derived deposit
 * address into a fresh P1SAT-derived funding output.
 *
 * Run by the wallet (or an explicit caller) after a batch of inbound
 * payments has been internalized. Plain BSV inbounds are parked in
 * `DEPOSIT_BASKET` by `internalizeBeef` and stay there until this helper
 * picks them up — so a failed sweep is harmless; the next call retries.
 *
 * Each call queries every UTXO currently in the deposit basket, builds
 * one createAction that spends them all, and locks the change to a freshly
 * derived address recorded in `FUNDING_BASKET`. From that point the funds
 * are normal P1SAT-protocol funding, available for ordinary spending.
 */

import { DEPOSIT_BASKET, FUNDING_BASKET, P1SAT_PROTOCOL } from '@1sat/types'
import { P2PKH, PublicKey, Utils } from '@bsv/sdk'
import type { Action, ActionOptions } from '../types'
import { executeTrackedAction } from '../utils/createTrackedAction'
import { signP2PKHInput } from '../utils/signP2PKH'

// ============================================================================
// Types
// ============================================================================

export interface SweepDepositInput extends ActionOptions {
	/** Optional cap on UTXOs to sweep in one tx (default: 50). */
	limit?: number
}

export interface SweepDepositResult {
	txid?: string
	swept: number
	error?: string
}

// ============================================================================
// Internal helpers
// ============================================================================

interface DepositInputInfo {
	outpoint: string
	keyID: string
	satoshis: number
}

/**
 * Generate a unique keyID for the sweep destination output. The funds
 * land at a self-derived address under P1SAT — the keyID just needs to
 * be unique and recoverable from the on-chain output's customInstructions.
 */
function generateSweepKeyID(): string {
	const random = new Uint8Array(8)
	crypto.getRandomValues(random)
	return `sweep ${Utils.toHex(Array.from(random))}`
}

// ============================================================================
// Action
// ============================================================================

export const sweepDeposit: Action<SweepDepositInput, SweepDepositResult> = {
	meta: {
		name: 'sweepDeposit',
		description:
			'Rotate plain BSV from the deposit basket into a fresh funding output',
		category: 'sweep',
		inputSchema: {
			type: 'object',
			properties: {
				limit: {
					type: 'integer',
					description: 'Maximum UTXOs to sweep in one tx (default 50)',
				},
			},
			required: [],
		},
	},
	async execute(ctx, input) {
		const limit = input.limit ?? 50

		// 1. Find every plain-BSV UTXO sitting in the deposit basket.
		const list = await ctx.wallet.listOutputs({
			basket: DEPOSIT_BASKET,
			includeCustomInstructions: true,
			limit,
		})
		if (list.outputs.length === 0) {
			return { swept: 0 }
		}

		const inputs: DepositInputInfo[] = []
		for (const out of list.outputs) {
			if (!out.customInstructions) continue
			let parsed: { keyID?: string }
			try {
				parsed = JSON.parse(out.customInstructions)
			} catch {
				continue
			}
			if (!parsed.keyID) continue
			inputs.push({
				outpoint: out.outpoint,
				keyID: parsed.keyID,
				satoshis: out.satoshis,
			})
		}
		if (inputs.length === 0) {
			return { swept: 0 }
		}

		// 2. Derive a fresh destination address under P1SAT_PROTOCOL.
		const destKeyID = generateSweepKeyID()
		const { publicKey: destPubHex } = await ctx.wallet.getPublicKey({
			protocolID: P1SAT_PROTOCOL,
			keyID: destKeyID,
			forSelf: true,
		})
		const destAddress = PublicKey.fromString(destPubHex).toAddress()
		const destLockingScript = new P2PKH().lock(destAddress).toHex()

		// 3. Build the sweep tx via createAction. Total satoshis less the
		//    wallet-allocated fee land at the destination output.
		const totalIn = inputs.reduce((s, i) => s + i.satoshis, 0)

		const result = await executeTrackedAction(
			ctx.wallet,
			{
				description: 'Sweep deposit funds',
				inputs: inputs.map((i) => ({
					outpoint: i.outpoint,
					inputDescription: 'Deposit sweep',
					unlockingScriptLength: 108,
				})),
				outputs: [
					{
						lockingScript: destLockingScript,
						satoshis: totalIn,
						outputDescription: 'Swept funding',
						basket: FUNDING_BASKET,
						customInstructions: JSON.stringify({
							protocolID: P1SAT_PROTOCOL,
							keyID: destKeyID,
						}),
					},
				],
				options: {
					randomizeOutputs: false,
					acceptDelayedBroadcast: false,
				},
			},
			input.fundingProvider,
			undefined,
			async (tx) => {
				const spends: Record<number, { unlockingScript: string }> = {}
				for (let i = 0; i < inputs.length; i++) {
					const unlock = await signP2PKHInput(
						ctx,
						tx,
						i,
						P1SAT_PROTOCOL,
						inputs[i].keyID,
					)
					if (typeof unlock !== 'string') {
						throw new Error(
							`sweepDeposit: failed to sign input ${i}: ${unlock.error}`,
						)
					}
					spends[i] = { unlockingScript: unlock }
				}
				return spends
			},
		)

		return {
			txid: result.txid,
			swept: inputs.length,
		}
	},
}

