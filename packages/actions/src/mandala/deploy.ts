/**
 * Mandala (BRC-162) deploy.
 *
 * Filing: a **label** on the transaction indexes tokens — `mandala` on every
 * Mandala transaction, `mandala <txid> <vout>` per token (`listActions` answers
 * "which tokens does this wallet track", and labels survive outputs being
 * spent). **Per-token baskets** `mandala <txid> <vout>` hold outputs: every
 * value/authority output of a token, the deploy output included.
 */

import { OverlayClient } from '@1sat/client'
import { Mandala, type MandalaMetadata } from '@1sat/templates'
import {
	type Destination,
	MANDALA_DEPLOY_PROTOCOL,
	MANDALA_LABEL,
	MANDALA_TOPIC,
	mandalaTokenBasket,
	mandalaTokenLabel,
} from '@1sat/types'
import type { AtomicBEEF, CreateActionArgs } from '@bsv/sdk'
import type { Action, OneSatContext } from '../types.js'
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
	/** The token's deploy outpoint `<txid>_0`; its basket, label and protocol name are `mandala <txid> 0` */
	tokenId?: string
	/**
	 * Set with `txid`/`tx` when the deploy was created but not filed: re-run
	 * the filing with {@link fileMandalaDeploy}.
	 */
	error?: string
}

/**
 * File a deploy output into its token's basket: `internalizeAction` on the
 * deploy transaction, vout 0 by `basket insertion` into `mandala <txid> 0` with
 * the derivation triple as customInstructions, labels `mandala` and
 * `mandala <txid> 0`.
 */
async function fileDeploy(
	ctx: OneSatContext,
	txid: string,
	tx: AtomicBEEF,
	customInstructions: string | undefined,
): Promise<void> {
	const token = { txid, vout: 0 }
	await ctx.wallet.internalizeAction({
		tx,
		outputs: [
			{
				outputIndex: 0,
				protocol: 'basket insertion',
				insertionRemittance: {
					basket: mandalaTokenBasket(token),
					customInstructions,
				},
			},
		],
		labels: [MANDALA_LABEL, mandalaTokenLabel(token)],
		description: 'File Mandala deploy',
	})
}

/**
 * Deploy a Mandala token: one `createAction` and one `internalizeAction` on
 * the same transaction.
 *
 * 1. `createAction` with the deploy output at vout 0 (`randomizeOutputs:
 *    false`) and no basket (an output cannot later be moved out of a basket),
 *    customInstructions = the key derivation only, label `mandala`.
 *    Broadcast by the wallet, or via `overlay` (see
 *    {@link DeployMandalaInput.overlay}).
 * 2. `internalizeAction` on that transaction: vout 0 is inserted into the
 *    per-token basket `mandala <txid> 0` with the same customInstructions, and
 *    the labels `mandala` and `mandala <txid> 0` are added. When this step
 *    fails the result carries `txid`, `tx` and the error; the action is still
 *    labelled `mandala`, and {@link fileMandalaDeploy} re-runs the filing.
 *
 * The deploy key derives under `MANDALA_DEPLOY_PROTOCOL` = `[2, 'mandala
 * deploy']`, keyID `mandala-deploy-<hex>`: the token id is this
 * transaction's txid, unknown while the key is derived.
 *
 * The token is named by the deploy outpoint `<txid>_0`; on chain its BRC-162
 * id is the 32-byte txid. Amount and id are read from the script,
 * `sym`/`dec`/`icon` from the deploy payload — none are copied into
 * customInstructions.
 */
export const deployMandala: Action<DeployMandalaInput, DeployMandalaResponse> =
	{
		meta: {
			name: 'deployMandala',
			description:
				'Deploy a Mandala (BRC-162) token: amount > 0 is fixed supply, 0 is an authority deploy. The token is named by the deploy outpoint <txid>_0.',
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
					protocolID: MANDALA_DEPLOY_PROTOCOL,
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

				try {
					await fileDeploy(ctx, txid, tx, customInstructions)
				} catch (error) {
					return {
						txid,
						tx,
						tokenId: `${txid}_0`,
						error: `file-failed: ${error instanceof Error ? error.message : String(error)}`,
					}
				}

				return { txid, tx, tokenId: `${txid}_0` }
			} catch (error) {
				return {
					error: error instanceof Error ? error.message : 'unknown-error',
				}
			}
		},
	}

export interface FileMandalaDeployInput {
	/** The deploy txid (the token is `<txid>_0`) */
	txid: string
	/**
	 * Atomic BEEF of the deploy (the `tx` {@link deployMandala} returned).
	 * When omitted it is fetched with `ctx.services.getBeefForTxid`.
	 */
	tx?: number[]
}

export interface FileMandalaDeployResponse {
	txid?: string
	tokenId?: string
	error?: string
}

/**
 * Re-run the filing step of {@link deployMandala} for a deploy that was
 * created but not filed. The customInstructions are read back from the
 * `mandala`-labelled action's vout 0 (`listActions`).
 */
export const fileMandalaDeploy: Action<
	FileMandalaDeployInput,
	FileMandalaDeployResponse
> = {
	meta: {
		name: 'fileMandalaDeploy',
		description:
			'File a created Mandala deploy output into its token basket (retry of the deploy internalize)',
		category: 'tokens',
		inputSchema: {
			type: 'object',
			properties: {
				txid: { type: 'string', description: 'Deploy txid' },
				tx: {
					type: 'array',
					description:
						'Atomic BEEF of the deploy; fetched from services when omitted',
				},
			},
			required: ['txid'],
		},
	},
	async execute(ctx, input) {
		try {
			const txid = input.txid.toLowerCase()
			const listed = await ctx.wallet.listActions({
				labels: [MANDALA_LABEL],
				includeOutputs: true,
				limit: 10000,
			})
			const action = listed.actions.find((a) => a.txid === txid)
			if (!action) return { error: 'deploy-not-found' }
			const out = action.outputs?.find((o) => o.outputIndex === 0)
			let tx = input.tx
			if (!tx) {
				if (!ctx.services) return { error: 'services-required' }
				tx = (await ctx.services.getBeefForTxid(txid)).toBinaryAtomic(txid)
			}
			await fileDeploy(ctx, txid, tx, out?.customInstructions)
			return { txid, tokenId: `${txid}_0` }
		} catch (error) {
			return {
				error: error instanceof Error ? error.message : String(error),
			}
		}
	},
}
