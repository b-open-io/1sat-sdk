/**
 * 1Color (BRC-162) deploy through the wallet's BRC-207 `color` module.
 *
 * One `createAction`: output 0 is the deploy, locked to the key derived under
 * `colorProtocolID(ISSUE, prefix, suffix)`, keyID `color`, counterparty self;
 * the labels carry the BRC-207 plan (`ColorPlan.toLabels`) naming that output
 * as owned, with one `deploy-fixed` (amount > 0) or `deploy-authority`
 * (amount 0) operation; `randomizeOutputs: false`. The module checks the
 * plan, files the signed deploy into its asset basket and submits it to
 * `tm_color` and the asset's topic. The asset id is `<txid>_0`.
 */

import { OneColor, type OneColorMetadata } from '@1sat/templates'
import {
	COLOR_KEY_ID,
	ColorPlan,
	ISSUE,
	colorProtocolID,
} from '@bsv/color-permission-module'
import { type CreateActionArgs, PublicKey } from '@bsv/sdk'
import { randomBase64 } from '../metanet/deliver.js'
import type { Action } from '../types.js'

export interface Deploy1ColorInput {
	/** Supply: > 0 is a fixed-supply deploy, 0 an authority deploy */
	amount: string | bigint
	/** Decimal places (`dec`), 0-18 */
	decimals?: number
	/** Ticker (`sym`); not unique */
	symbol?: string
	/** Icon (`icon`): the image embedded in the deploy, as its media type and bytes */
	icon?: { mediaType: string; bytes: number[] | Uint8Array }
}

export interface Deploy1ColorResponse {
	txid?: string
	/** AtomicBEEF of the deploy transaction */
	tx?: number[]
	/** The asset id, `<txid>_0` */
	assetId?: string
	error?: string
}

export const deploy1Color: Action<Deploy1ColorInput, Deploy1ColorResponse> = {
	meta: {
		name: 'deploy1Color',
		description:
			"Deploy a 1Color (BRC-162) token through the wallet's BRC-207 color module: amount > 0 is fixed supply, 0 is an authority deploy. The asset id is <txid>_0.",
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
					type: 'object',
					description:
						'Icon embedded in the deploy: { mediaType (e.g. image/png), bytes (array of byte values) }',
					properties: {
						mediaType: { type: 'string' },
						bytes: { type: 'array', items: { type: 'integer' } },
					},
					required: ['mediaType', 'bytes'],
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

			const derivationPrefix = randomBase64()
			const derivationSuffix = randomBase64()
			const { publicKey: identityKey } = await ctx.wallet.getPublicKey({
				identityKey: true,
			})
			const { publicKey } = await ctx.wallet.getPublicKey({
				protocolID: colorProtocolID(ISSUE, derivationPrefix, derivationSuffix),
				keyID: COLOR_KEY_ID,
				counterparty: 'self',
				forSelf: true,
			})
			const lock = PublicKey.fromString(publicKey).toHash() as number[]

			const payload: OneColorMetadata = {}
			if (input.symbol !== undefined) payload.sym = input.symbol
			if (input.decimals !== undefined) payload.dec = input.decimals
			if (input.icon !== undefined) {
				payload.icon = {
					mediaType: input.icon.mediaType,
					bytes: Uint8Array.from(input.icon.bytes),
				}
			}
			const deploy = authority
				? OneColor.deployAuthority({ lock, payload })
				: OneColor.deployValue(amount, { lock, payload })

			const args: CreateActionArgs = {
				description: authority
					? 'Deploy 1Color token (authority)'
					: 'Deploy 1Color token (fixed supply)',
				outputs: [
					{
						lockingScript: deploy.lock().toHex(),
						satoshis: 1,
						outputDescription: '1Color deploy',
					},
				],
				labels: ColorPlan.toLabels({
					version: 1,
					assets: [ISSUE],
					ownedOutputs: [
						{
							outputIndex: 0,
							assetId: ISSUE,
							derivationPrefix,
							derivationSuffix,
							senderIdentityKey: identityKey,
						},
					],
					operations: [
						{
							assetId: ISSUE,
							operation: authority ? 'deploy-authority' : 'deploy-fixed',
						},
					],
					inputPositions: [],
					changePositions: [],
					sighashTypes: [],
				}),
				options: { randomizeOutputs: false },
			}

			const created = await ctx.wallet.createAction(args)
			if (!created.txid || !created.tx) return { error: 'no-transaction' }
			return {
				txid: created.txid,
				tx: Array.from(created.tx),
				assetId: `${created.txid}_0`,
			}
		} catch (error) {
			return {
				error: error instanceof Error ? error.message : String(error),
			}
		}
	},
}
