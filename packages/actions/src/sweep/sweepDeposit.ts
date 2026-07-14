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

import { DEPOSIT_BASKET, P1SAT_PROTOCOL } from '@1sat/types'
import type { WalletCounterparty, WalletProtocol } from '@bsv/sdk'
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
	protocolID: WalletProtocol
	counterparty: WalletCounterparty
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
			let parsed: {
				keyID?: string
				protocolID?: WalletProtocol
				counterparty?: WalletCounterparty
			}
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
				// Legacy records predate protocol/counterparty in
				// customInstructions; they were all P1SAT/self.
				protocolID: parsed.protocolID ?? P1SAT_PROTOCOL,
				counterparty: parsed.counterparty ?? 'self',
			})
		}
		if (inputs.length === 0) {
			return { swept: 0 }
		}

		// 2. Build the sweep tx via createAction with NO explicit outputs.
		//    The wallet's own change handler creates a single BRC-29-derived
		//    change output for the full input value (less fee), recording
		//    proper derivationPrefix/derivationSuffix/senderIdentityKey
		//    columns and depositing it into the standard funding basket.
		//    That is exactly how every other BRC-29 funding output in the
		//    wallet is created — sweep just rides the same path.
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
				outputs: [],
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
						inputs[i].protocolID,
						inputs[i].keyID,
						inputs[i].counterparty,
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

