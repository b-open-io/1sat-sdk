/**
 * sweepDeposit — rotate plain BSV out of the user's P1SAT-derived deposit
 * address into a fresh BRC-29-derived funding output.
 *
 * Run by the wallet (or an explicit caller) after a batch of inbound
 * payments has been internalized. Plain BSV inbounds are parked in
 * `DEPOSIT_BASKET` by `internalizeBeef` and stay there until this helper
 * picks them up — so a failed sweep is harmless; the next call retries.
 *
 * Each call queries every UTXO currently in the deposit basket, builds
 * one createAction that spends them all (signed under P1SAT), and locks
 * the change to a freshly BRC-29-derived address recorded in `FUNDING_BASKET`.
 * From that point the funds are normal BRC-29 funding, available for
 * ordinary spending under the wallet's standard funding protocol.
 */

import {
	BRC29_PROTOCOL_ID,
	DEPOSIT_BASKET,
	FUNDING_BASKET,
	P1SAT_PROTOCOL,
} from '@1sat/types'
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
 * land at a self-derived address under BRC-29 — the keyID just needs to
 * be unique and recoverable from the on-chain output's customInstructions.
 * BRC-29 keyID convention is `${derivationPrefix} ${derivationSuffix}`
 * (space-separated base64); we follow that shape with random bytes so any
 * BRC-29-aware tooling can parse the parts.
 */
function generateSweepKeyID(): string {
	const prefixBytes = new Uint8Array(4)
	const suffixBytes = new Uint8Array(8)
	crypto.getRandomValues(prefixBytes)
	crypto.getRandomValues(suffixBytes)
	return `${Utils.toBase64(Array.from(prefixBytes))} ${Utils.toBase64(Array.from(suffixBytes))}`
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

		// 1. Find every plain-BSV UTXO sitting in the deposit basket. Pull
		//    full tx data so we can hand the wallet a self-contained
		//    inputBEEF for the sweep. The wallet stored each deposit's
		//    parent BEEF chain at internalize time; getValidBeefForTxid
		//    reassembles it here when the deposit isn't yet proven.
		const list = await ctx.wallet.listOutputs({
			basket: DEPOSIT_BASKET,
			includeCustomInstructions: true,
			include: 'entire transactions',
			limit,
		})
		if (list.outputs.length === 0) {
			return { swept: 0 }
		}
		const inputBEEF = list.BEEF ? Array.from(list.BEEF) : undefined

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

		// 2. Derive a fresh destination address under BRC-29 — sweep target
		//    is the wallet's standard funding protocol, so spending the
		//    output later goes through the normal BRC-29 funding path.
		const destKeyID = generateSweepKeyID()
		const { publicKey: destPubHex } = await ctx.wallet.getPublicKey({
			protocolID: BRC29_PROTOCOL_ID,
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
				inputBEEF,
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
							protocolID: BRC29_PROTOCOL_ID,
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
			inputBEEF,
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

