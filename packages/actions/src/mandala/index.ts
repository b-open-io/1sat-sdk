/**
 * Mandala (BRC-162) token actions.
 */

import { OverlayClient } from '@1sat/client'
import { Mandala, type MandalaMetadata } from '@1sat/templates'
import {
	type Destination,
	MANDALA_AUTH_TAG,
	MANDALA_BASKET,
	MANDALA_DEPLOY_TAG,
	MANDALA_TOPIC,
	mandalaTokenTag,
} from '@1sat/types'
import type { CreateActionArgs } from '@bsv/sdk'
import { P1SAT_PROTOCOL } from '../constants.js'
import type { FundingProvider } from '../funding/index.js'
import { createWalletFundingProvider } from '../funding/walletFunding.js'
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
	 * Overlay base URL. When set, the deploy is broadcast as a BRC-22 submit
	 * to `<overlay>/submit` with `X-Topics: tm_mandala,tm_<txid>` instead of
	 * `services.postBeef`; a STEAK response is success. Applies to the default
	 * funding provider. This is the pattern other broadcasting actions adopt.
	 */
	overlay?: string
	/**
	 * Side-door funding. Defaults to {@link createWalletFundingProvider} over
	 * the context's wallet and services.
	 */
	fundingProvider?: FundingProvider
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
 * Deploy a Mandala token. The deploy output is vout 0; the token id is the
 * deploy txid. The transaction is funded through a side door
 * ({@link FundingProvider}) and then internalized into `mandala` with the
 * tags `mandala:<txid>`, `mandala:deploy` and, for an authority deploy,
 * `mandala:auth` — `createAction` cannot tag an output with its own txid.
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
							'Overlay base URL: broadcast as a BRC-22 submit (tm_mandala, tm_<txid>) instead of the default broadcaster',
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
					protocolID: P1SAT_PROTOCOL,
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

				const tags = authority
					? [MANDALA_DEPLOY_TAG, MANDALA_AUTH_TAG]
					: [MANDALA_DEPLOY_TAG]
				const customInstructions = JSON.stringify({
					...resolved.customInstructions,
					amt: amount.toString(),
					...(input.decimals !== undefined && { dec: input.decimals }),
					...(input.symbol !== undefined && { sym: input.symbol }),
					...(input.icon !== undefined && { icon: input.icon }),
				})

				const args: CreateActionArgs = {
					description: authority
						? 'Deploy Mandala token (authority)'
						: 'Deploy Mandala token (fixed supply)',
					outputs: [
						{
							lockingScript: deploy.lock().toHex(),
							satoshis: 1,
							outputDescription: 'Mandala deploy',
							basket: MANDALA_BASKET,
							tags,
							customInstructions,
						},
					],
					options: { randomizeOutputs: false },
				}

				const provider =
					input.fundingProvider ??
					createWalletFundingProvider(
						ctx,
						input.overlay ? { broadcast: overlaySubmit(input.overlay) } : {},
					)
				let tx: number[] | undefined
				// The txid is known only once the provider has built the
				// transaction; executeTrackedAction reads the output tags after
				// fund() returns, so the token tag is added here.
				const tagging: FundingProvider = {
					async fund(fundArgs) {
						const funded = await provider.fund(fundArgs)
						const out = fundArgs.outputs?.[0]
						if (out) {
							out.tags = [...(out.tags ?? []), mandalaTokenTag(funded.txid)]
						}
						tx = Array.from(funded.tx)
						return funded
					},
				}

				const result = await executeTrackedAction(ctx.wallet, args, tagging)
				if (!result.txid) return { error: result.error ?? 'deploy-no-txid' }
				return { txid: result.txid, tx, tokenId: result.txid }
			} catch (error) {
				return {
					error: error instanceof Error ? error.message : 'unknown-error',
				}
			}
		},
	}

/**
 * BRC-22 submit of a deploy to `<overlay>/submit` under `tm_mandala` and the
 * token's own topic `tm_<txid>`. Any STEAK (a JSON object) is success.
 */
function overlaySubmit(overlay: string) {
	return async (beef: number[] | Uint8Array, txid: string): Promise<void> => {
		const steak = await new OverlayClient(overlay).submitBrc22(beef, [
			MANDALA_TOPIC,
			`tm_${txid}`,
		])
		if (!steak || typeof steak !== 'object' || Array.isArray(steak)) {
			throw new Error('overlay-no-steak')
		}
	}
}

export const mandalaActions = [deployMandala]
