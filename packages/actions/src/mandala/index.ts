/**
 * Mandala (BRC-162) token actions.
 *
 * Filing: a **label** on the transaction indexes tokens — `mandala` on every
 * Mandala transaction, `mandala:<txid>` per token (`listActions` answers
 * "which tokens does this wallet track", and labels survive outputs being
 * spent). **Per-token baskets** hold outputs: every value/authority output of
 * a token, the deploy output included, lives in `mandalaTokenBasket(txid)`.
 */

import { OverlayClient } from '@1sat/client'
import { Mandala, type MandalaMetadata } from '@1sat/templates'
import {
	type Destination,
	MANDALA_BASKET,
	MANDALA_LABEL,
	MANDALA_PROTOCOL,
	MANDALA_TOPIC,
	mandalaTokenBasket,
	mandalaTokenLabel,
} from '@1sat/types'
import type { CreateActionArgs } from '@bsv/sdk'
import type { Action } from '../types.js'
import { executeTrackedAction } from '../utils/createTrackedAction.js'
import { resolveDestination } from '../utils/resolveDestination.js'

export interface DeployMandalaInput {
	/** Supply: > 0 is a fixed-supply deploy, 0 an authority deploy */
	amount: string | bigint
	/** Decimal places (`dec`), 0-18 */
	decimals?: number
	/** Ticker (`sym`); not unique */
	symbol?: string
	/** Icon pointer: `txid_vout` outpoint, or an output index in this transaction */
	icon?: string | number
	/** Holder of the deploy output. Defaults to self */
	destination?: Destination
	/**
	 * Overlay base URL. When set, the wallet creates the deploy with
	 * `noSend` and it is broadcast as a BRC-22 submit to `<overlay>/submit`
	 * with `X-Topics: tm_mandala,tm_<txid>` instead of the wallet's broadcast;
	 * a STEAK response is success. This `overlay` input is the pattern other
	 * broadcasting actions adopt.
	 */
	overlay?: string
}

export interface DeployMandalaResponse {
	txid?: string
	/** AtomicBEEF of the deploy transaction */
	tx?: number[]
	/** Token id: the deploy txid alone (never `txid_0`) */
	tokenId?: string
	error?: string
}

/**
 * Deploy a Mandala token: one `createAction` and one `internalizeAction` on
 * the same transaction.
 *
 * 1. `createAction` with the deploy output at vout 0 (`randomizeOutputs:
 *    false`) in the placeholder basket `mandala`, customInstructions = the
 *    key derivation only, label `mandala`. Broadcast by the wallet, or via
 *    `overlay` (see {@link DeployMandalaInput.overlay}).
 * 2. `internalizeAction` on that transaction: vout 0 moves to the per-token
 *    basket `mandalaTokenBasket(txid)` with the same customInstructions, and
 *    the labels `mandala` and `mandala:<txid>` are added.
 *
 * The token id is the deploy txid. Amount and id are read from the script,
 * `sym`/`dec`/`icon` from the deploy payload — none are copied into
 * customInstructions.
 */
export const deployMandala: Action<DeployMandalaInput, DeployMandalaResponse> =
	{
		meta: {
			name: 'deployMandala',
			description:
				'Deploy a Mandala (BRC-162) token: amount > 0 is fixed supply, 0 is an authority deploy. Token id = deploy txid.',
			category: 'tokens',
			inputSchema: {
				type: 'object',
				properties: {
					amount: {
						type: 'string',
						description:
							'Supply as a string for bigint: > 0 fixed supply, 0 authority deploy',
					},
					decimals: {
						type: 'integer',
						description: 'Decimal places (0-18)',
					},
					symbol: { type: 'string', description: 'Token symbol/ticker' },
					icon: {
						type: 'string',
						description:
							'Icon outpoint (txid_vout), or an output index in the deploy transaction',
					},
					destination: {
						type: 'object',
						description:
							'Holder destination. One of lockingScript (hex), counterparty (pubkey), or address. Defaults to self.',
					},
					overlay: {
						type: 'string',
						description:
							'Overlay base URL: broadcast as a BRC-22 submit (tm_mandala, tm_<txid>) instead of the wallet broadcast',
					},
				},
				required: ['amount'],
			},
		},
		async execute(ctx, input) {
			try {
				const amount =
					typeof input.amount === 'string' ? BigInt(input.amount) : input.amount
				const authority = amount === 0n

				const resolved = await resolveDestination(ctx, input.destination, {
					protocolID: MANDALA_PROTOCOL,
					keyIDPrefix: 'mandala-deploy',
				})

				const payload: MandalaMetadata = {}
				if (input.symbol !== undefined) payload.sym = input.symbol
				if (input.decimals !== undefined) payload.dec = input.decimals
				if (input.icon !== undefined) payload.icon = input.icon
				const deploy = authority
					? Mandala.deployAuthority({ lock: resolved.lockingScript, payload })
					: Mandala.deployValue(amount, {
							lock: resolved.lockingScript,
							payload,
						})

				// Derivation only (absent for an address / literal-script destination).
				const customInstructions = resolved.customInstructions
					? JSON.stringify(resolved.customInstructions)
					: undefined
				const description = authority
					? 'Deploy Mandala token (authority)'
					: 'Deploy Mandala token (fixed supply)'

				const args: CreateActionArgs = {
					description,
					outputs: [
						{
							lockingScript: deploy.lock().toHex(),
							satoshis: 1,
							outputDescription: 'Mandala deploy',
							basket: MANDALA_BASKET,
							customInstructions,
						},
					],
					labels: [MANDALA_LABEL],
					options: {
						randomizeOutputs: false,
						...(input.overlay && { noSend: true }),
					},
				}

				const created = await executeTrackedAction(ctx.wallet, args)
				if (created.error) return { error: created.error }
				if (!created.txid || !created.tx) return { error: 'deploy-no-tx' }
				const txid = created.txid
				const tx = created.tx

				if (input.overlay) {
					const steak = await new OverlayClient(input.overlay).submitBrc22(tx, [
						MANDALA_TOPIC,
						`tm_${txid}`,
					])
					if (!steak || typeof steak !== 'object' || Array.isArray(steak)) {
						return { txid, tx, error: 'overlay-no-steak' }
					}
				}

				await ctx.wallet.internalizeAction({
					tx,
					outputs: [
						{
							outputIndex: 0,
							protocol: 'basket insertion',
							insertionRemittance: {
								basket: mandalaTokenBasket(txid),
								customInstructions,
							},
						},
					],
					labels: [MANDALA_LABEL, mandalaTokenLabel(txid)],
					description,
				})

				return { txid, tx, tokenId: txid }
			} catch (error) {
				return {
					error: error instanceof Error ? error.message : 'unknown-error',
				}
			}
		},
	}

export const mandalaActions = [deployMandala]
