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
import {
	Mandala,
	type MandalaMetadata,
	buildInscriptionScript,
} from '@1sat/templates'
import {
	type Destination,
	MANDALA_DEPLOY_PROTOCOL,
	MANDALA_LABEL,
	MANDALA_TOPIC,
	P1SAT_PROTOCOL,
	mandalaOutpoint,
	mandalaTokenBasket,
	mandalaTokenLabel,
} from '@1sat/types'
import {
	type AtomicBEEF,
	Beef,
	type CreateActionArgs,
	type CreateActionOutput,
	Hash,
	Utils,
} from '@bsv/sdk'
import { MAX_INSCRIPTION_BYTES, ORDINALS_BASKET } from '../constants.js'
import type { Action, OneSatContext } from '../types.js'
import { executeTrackedAction } from '../utils/createTrackedAction.js'
import { buildOrdinalCustomInstructions } from '../utils/ordinalRemittance.js'
import { resolveDestination } from '../utils/resolveDestination.js'
import { toSubjectBeef } from '../utils/subjectBeef.js'

/**
 * An icon that already exists on chain: its outpoint, and optionally a BEEF
 * holding that outpoint's transaction. Without `beef` the transaction is
 * fetched with `ctx.services.getBeefForTxid`.
 */
export interface DeployMandalaExternalIcon {
	/** Icon outpoint, `txid_vout` or `txid.vout` */
	outpoint: string
	/** BEEF (plain or Atomic) containing the outpoint's transaction */
	beef?: number[]
}

/**
 * An icon inscribed in the deploy transaction itself, on its own 1-sat
 * output at vout 1, filed into basket `1sat` like a fresh `inscribe`.
 */
export interface DeployMandalaInlineIcon {
	/** Base64 encoded icon content */
	base64Content: string
	/** Content type (MIME type) */
	contentType: string
}

export interface DeployMandalaInput {
	/** Supply: > 0 is a fixed-supply deploy, 0 an authority deploy */
	amount: string | bigint
	/** Decimal places (`dec`), 0-18 */
	decimals?: number
	/** Ticker (`sym`); not unique */
	symbol?: string
	/**
	 * Icon:
	 * - an outpoint string (`txid_vout` or `txid.vout`), or
	 *   {@link DeployMandalaExternalIcon} `{outpoint, beef?}`: an icon already
	 *   on chain. Its transaction is checked before the deploy is created
	 *   (from `beef` when given, else fetched from services) and travels with
	 *   the deploy in a Subject BEEF submission;
	 * - {@link DeployMandalaInlineIcon} `{base64Content, contentType}`: the
	 *   icon is inscribed in the deploy transaction at vout 1 and the payload
	 *   points at it (`icon` = 1);
	 * - a number: an output index in the deploy transaction, encoded as is.
	 */
	icon?: string | number | DeployMandalaExternalIcon | DeployMandalaInlineIcon
	/** Holder of the deploy output. Defaults to self */
	destination?: Destination
	/**
	 * Overlay base URL (required). The wallet creates the deploy with
	 * `noSend` and it is broadcast as a BRC-22 submit to `<overlay>/submit`
	 * with `X-Topics: tm_mandala`. Success is only a STEAK for `tm_mandala`
	 * (admittance instructions keyed by topic); any other answer, `{id}`
	 * included, is `overlay-no-steak` and nothing is filed. The body is
	 * the deploy's Atomic BEEF, or a Subject BEEF (BRC-233) about the deploy
	 * carrying an external icon's transaction.
	 */
	overlay: string
}

export interface DeployMandalaResponse {
	txid?: string
	/** AtomicBEEF of the deploy transaction */
	tx?: number[]
	/** The token's BRC-36 deploy outpoint `<txid>.0`; its basket, label and protocol name are `mandala <txid> 0` */
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

/** A list of output/input indices, as in BRC-22 admittance instructions. */
function isIndexList(value: unknown): boolean {
	return Array.isArray(value) && value.every((i) => Number.isInteger(i))
}

/**
 * Whether an overlay's answer is a STEAK (`@bsv/sdk` `STEAK`) for `topics`:
 * an object keyed by topic whose values are admittance instructions
 * (`outputsToAdmit`, `coinsToRetain`, optional `coinsRemoved`), with every
 * submitted topic present. Anything else (e.g. `{id}`) is not.
 */
function isSteakFor(answer: unknown, topics: string[]): boolean {
	if (!answer || typeof answer !== 'object' || Array.isArray(answer)) {
		return false
	}
	const entries = Object.entries(answer)
	return (
		topics.every((topic) => Object.hasOwn(answer, topic)) &&
		entries.every(([, value]) => {
			if (!value || typeof value !== 'object') return false
			const v = value as Record<string, unknown>
			return (
				isIndexList(v.outputsToAdmit) &&
				isIndexList(v.coinsToRetain) &&
				(v.coinsRemoved === undefined || isIndexList(v.coinsRemoved))
			)
		})
	)
}

/** The deploy's icon, resolved before anything is created. */
interface ResolvedIcon {
	/** The payload's `icon` */
	payload?: string | number
	/** External icon: a BEEF holding the icon's transaction */
	beef?: Beef
	/** Inline icon: the inscription output at vout 1 */
	output?: CreateActionOutput
	error?: string
}

/**
 * Resolve {@link DeployMandalaInput.icon}. An external icon's transaction
 * must be in the given BEEF (never fetched instead), or — when no BEEF is
 * given — fetched from services; the outpoint's vout must exist in it.
 */
async function resolveIcon(
	ctx: OneSatContext,
	icon: DeployMandalaInput['icon'],
): Promise<ResolvedIcon> {
	if (icon === undefined) return {}
	if (typeof icon === 'number') return { payload: icon }
	if (typeof icon === 'string' || 'outpoint' in icon) {
		const external = typeof icon === 'string' ? { outpoint: icon } : icon
		const { txid, vout } = mandalaOutpoint(external.outpoint)
		let beef: Beef
		if (external.beef) {
			beef = Beef.fromBinary(external.beef)
		} else {
			if (!ctx.services) return { error: 'icon-services-required' }
			beef = await ctx.services.getBeefForTxid(txid)
		}
		const tx = beef.findTxid(txid)?.tx
		if (!tx) return { error: 'icon-beef-missing-tx' }
		if (!tx.outputs[vout]) return { error: 'icon-beef-missing-vout' }
		return { payload: `${txid}_${vout}`, beef }
	}

	// Inline: a fresh inscription, as the inscribe action files one.
	const content = Utils.toArray(icon.base64Content, 'base64')
	if (content.length > MAX_INSCRIPTION_BYTES) {
		return {
			error: `Inscription data too large: ${content.length} bytes (max ${MAX_INSCRIPTION_BYTES})`,
		}
	}
	const resolved = await resolveDestination(ctx, undefined, {
		protocolID: P1SAT_PROTOCOL,
		keyIDPrefix: 'inscribe',
	})
	const typeBase = icon.contentType.split(';')[0]?.trim() || icon.contentType
	const tags = [
		`type:${typeBase}`,
		'origin',
		`sha256:${Utils.toHex(Hash.sha256(content))}`,
	]
	const customInstructions = resolved.customInstructions
		? buildOrdinalCustomInstructions({
				protocolID: resolved.customInstructions.protocolID,
				keyID: resolved.customInstructions.keyID,
				counterparty: resolved.customInstructions.counterparty as
					| string
					| undefined,
				tags,
			})
		: undefined
	const lockingScript = buildInscriptionScript(
		resolved.lockingScript,
		new Uint8Array(content),
		icon.contentType,
	)
	return {
		payload: 1,
		output: {
			lockingScript: lockingScript.toHex(),
			satoshis: 1,
			outputDescription: 'Mandala icon inscription',
			basket: ORDINALS_BASKET,
			tags,
			customInstructions,
		},
	}
}

/**
 * Deploy a Mandala token: one `createAction`, one overlay submit and one
 * `internalizeAction` on the same transaction.
 *
 * 0. The icon is resolved first (see {@link DeployMandalaInput.icon}); when
 *    it fails nothing is created.
 * 1. `createAction` with `noSend`, the deploy output at vout 0
 *    (`randomizeOutputs: false`) and no basket (an output cannot later be
 *    moved out of a basket), customInstructions = the key derivation only,
 *    label `mandala`. An inline icon is the inscription output at vout 1,
 *    in basket `1sat`.
 * 2. BRC-22 submit to `overlay` (see {@link DeployMandalaInput.overlay}):
 *    the deploy's Atomic BEEF, or with an external icon a Subject BEEF
 *    (BRC-233) about the deploy whose BEEF V2 also holds the icon's
 *    transaction.
 * 3. `internalizeAction` on that transaction (which promotes the noSend
 *    transaction): vout 0 is inserted into the per-token basket
 *    `mandala <txid> 0` with the same customInstructions, and the labels
 *    `mandala` and `mandala <txid> 0` are added. When this step fails the
 *    result carries `txid`, `tx` and the error; the action is still labelled
 *    `mandala`, and {@link fileMandalaDeploy} re-runs the filing.
 *
 * The deploy key derives under `MANDALA_DEPLOY_PROTOCOL` = `[2, 'mandala
 * deploy']`, keyID `mandala-deploy-<hex>`: the token id is this
 * transaction's txid, unknown while the key is derived.
 *
 * The token is named by its BRC-36 deploy outpoint `<txid>.0`; on chain its BRC-162
 * id is the 32-byte txid. Amount and id are read from the script,
 * `sym`/`dec`/`icon` from the deploy payload — none are copied into
 * customInstructions.
 */
export const deployMandala: Action<DeployMandalaInput, DeployMandalaResponse> =
	{
		meta: {
			name: 'deployMandala',
			description:
				'Deploy a Mandala (BRC-162) token: amount > 0 is fixed supply, 0 is an authority deploy. The token is the BRC-36 deploy outpoint <txid>.0.',
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
							'Icon. {outpoint, beef?}: an icon on chain (txid_vout or txid.vout; beef = BEEF of its transaction, fetched from services when omitted); a bare outpoint string is the same without beef. {base64Content, contentType}: inscribe the icon in the deploy transaction at vout 1. A number: an output index in the deploy transaction.',
						properties: {
							outpoint: {
								type: 'string',
								description: 'Icon outpoint (txid_vout or txid.vout)',
							},
							beef: {
								type: 'array',
								description:
									'BEEF containing the outpoint transaction; fetched from services when omitted',
							},
							base64Content: {
								type: 'string',
								description: 'Base64 encoded icon to inscribe at vout 1',
							},
							contentType: {
								type: 'string',
								description: 'Content type (MIME type) of base64Content',
							},
						},
					},
					destination: {
						type: 'object',
						description:
							'Holder destination. One of lockingScript (hex), counterparty (pubkey), or address. Defaults to self.',
					},
					overlay: {
						type: 'string',
						description:
							'Overlay base URL: the deploy is created noSend and broadcast as a BRC-22 submit (tm_mandala); a STEAK answer is success',
					},
				},
				required: ['amount', 'overlay'],
			},
		},
		async execute(ctx, input) {
			try {
				if (!input.overlay) return { error: 'overlay-required' }
				const icon = await resolveIcon(ctx, input.icon)
				if (icon.error) return { error: icon.error }

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
				if (icon.payload !== undefined) payload.icon = icon.payload
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
						...(icon.output ? [icon.output] : []),
					],
					labels: [MANDALA_LABEL],
					options: {
						randomizeOutputs: false,
						noSend: true,
					},
				}

				const created = await executeTrackedAction(ctx.wallet, args)
				if (created.error) return { error: created.error }
				if (!created.txid || !created.tx) return { error: 'deploy-no-tx' }
				const txid = created.txid
				const tx = created.tx

				// External icon: Subject BEEF about the deploy, its BEEF V2 holding
				// the deploy (with ancestry) and the icon's transaction.
				let body: number[] = tx
				if (icon.beef) {
					const bag = new Beef()
					bag.mergeBeef(tx)
					bag.mergeBeef(icon.beef)
					body = toSubjectBeef(bag, txid)
				}

				const topics = [MANDALA_TOPIC]
				const answer: unknown = await new OverlayClient(
					input.overlay,
				).submitBrc22(body, topics)
				if (!isSteakFor(answer, topics)) {
					return { txid, tx, error: 'overlay-no-steak' }
				}

				try {
					await fileDeploy(ctx, txid, tx, customInstructions)
				} catch (error) {
					return {
						txid,
						tx,
						tokenId: `${txid}.0`,
						error: `file-failed: ${error instanceof Error ? error.message : String(error)}`,
					}
				}

				return { txid, tx, tokenId: `${txid}.0` }
			} catch (error) {
				return {
					error: error instanceof Error ? error.message : 'unknown-error',
				}
			}
		},
	}

export interface FileMandalaDeployInput {
	/** The deploy txid (the token is `<txid>.0`) */
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
			return { txid, tokenId: `${txid}.0` }
		} catch (error) {
			return {
				error: error instanceof Error ? error.message : String(error),
			}
		}
	},
}
