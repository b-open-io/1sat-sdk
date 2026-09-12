/**
 * OrdLock v2 purchase builder.
 *
 * The canonical batch contract binds each listing input `i` to the complete
 * output `i` (SIGHASH_SINGLE). The listed satoshi itself follows first-sat
 * ordering, so a purchase is laid out as
 *
 * ```text
 * inputs:  0…m-1 front funding · m listing            · wallet fee inputs
 * outputs: 0…m-1 cushion/fillers · m seller payout · m+1 receive · extras · wallet change
 * ```
 *
 * wallet-toolbox keeps explicit inputs in order, appends the funding inputs it
 * allocates after them, and appends change after the caller's outputs — but it
 * refuses to spend its own change outputs as explicit inputs. Front funding
 * therefore comes from the dedicated {@link ORDLOCK_FUNDING_BASKET}: existing
 * outputs there are reused when they cover the payout, and otherwise a small
 * preparation action creates one first. Any cushion (front funding minus the
 * payout) is returned to that basket so it can front the next purchase.
 */

import { OrdLockV2 } from '@1sat/templates'
import { readAssetIdTag } from '@1sat/types'
import {
	Beef,
	type CreateActionArgs,
	type CreateActionInput,
	type CreateActionOutput,
	LockingScript,
	P2PKH,
	PublicKey,
	type Script,
	Utils,
} from '@bsv/sdk'
import {
	ORDLOCK_FUNDING_BASKET,
	ORDLOCK_FUNDING_KEY_PREFIX,
	ORDLOCK_FUNDING_TAG,
	P1SAT_PROTOCOL,
} from '../constants.js'
import type { FundingProvider } from '../funding/index.js'
import type { Spend } from '../pipeline/spendTargets.js'
import type { OneSatContext } from '../types.js'
import { executeTrackedAction, randomActionId } from './createTrackedAction.js'
import { unlockingScriptLengthForInstructions } from './signOrdinalInput.js'
import { ensurePlaintextCi } from './walletMetadataCi.js'

/** A spendable output in the OrdLock funding basket. */
export interface OrdLockFundingOutput {
	/** `txid.vout` */
	outpoint: string
	satoshis: number
	/** Locking script hex */
	lockingScript: string
	/** Plaintext derivation CI (`{ protocolID, keyID, counterparty }`) */
	customInstructions?: string
	/** Tracking id (`id:` tag) when present */
	id?: string
}

/** Most front funding inputs a single purchase will combine. */
const MAX_FRONT_INPUTS = 4

export interface OrdLockV2PurchaseParams {
	/** Listing outpoint (`txid_vout` or `txid.vout`) */
	outpoint: string
	/** The listing's locking script (v2, trailing data allowed) */
	listingScript: Script
	/** BEEF proving the listing transaction */
	listingBeef: Beef
	/**
	 * The buyer's receive output: exactly 1 satoshi, with the basket, tags
	 * and customInstructions the wallet should file it under. The pipeline
	 * uses basketed 1-sat outputs as the approved delivery targets.
	 */
	receive: CreateActionOutput
	/** Outputs placed after the receive output (marketplace fee, overlay fee, ...) */
	extraOutputs?: CreateActionOutput[]
	description: string
	labels?: string[]
	fundingProvider?: FundingProvider
	usePermissionModule?: boolean
	permissionScheme?: import('@1sat/types').PermissionSchemeId
	/**
	 * Extra satoshis to add when a preparation action is needed, so that the
	 * cushion returned to the funding basket can front the next purchase
	 * without another preparation. Default 0 (fund exactly the payout).
	 */
	fundingReserve?: number
}

export interface OrdLockV2PurchaseBuild {
	args: CreateActionArgs
	spends: Spend[]
	inputBEEF: number[]
	/** Index of the listing input (= number of front funding inputs) */
	listingInputIndex: number
	/** Index of the buyer's receive output */
	receiveVout: number
	/** Index of the cushion output returned to the funding basket, or -1 */
	cushionVout: number
	/** txid of the preparation action, when one was needed */
	fundingTxid?: string
}

/** Spendable outputs in the OrdLock funding basket, with their BEEF. */
export async function loadOrdLockFunding(
	ctx: OneSatContext,
): Promise<{ outputs: OrdLockFundingOutput[]; beef?: Beef }> {
	const res = await ctx.wallet.listOutputs({
		basket: ORDLOCK_FUNDING_BASKET,
		include: 'entire transactions',
		includeTags: true,
		includeCustomInstructions: true,
		limit: 200,
	})
	const beef = res.BEEF?.length ? Beef.fromBinary(res.BEEF) : undefined
	const outputs: OrdLockFundingOutput[] = []
	for (const o of res.outputs) {
		if (!o.spendable) continue
		const [txid, voutStr] = o.outpoint.split('.')
		const script =
			beef
				?.findTxid(txid)
				?.tx?.outputs[Number(voutStr)]?.lockingScript.toHex() ?? o.lockingScript
		if (!script) continue
		outputs.push({
			outpoint: o.outpoint,
			satoshis: o.satoshis,
			lockingScript: script,
			customInstructions: await ensurePlaintextCi(
				ctx.wallet,
				o.customInstructions,
			),
			id: readAssetIdTag(o.tags),
		})
	}
	return { outputs, beef }
}

/**
 * Pick front funding covering `needed` sats: the smallest single output that
 * covers it, else the largest few combined. null when the basket cannot.
 */
export function selectOrdLockFunding(
	outputs: OrdLockFundingOutput[],
	needed: number,
): OrdLockFundingOutput[] | null {
	const asc = [...outputs].sort((a, b) => a.satoshis - b.satoshis)
	const single = asc.find((o) => o.satoshis >= needed)
	if (single) return [single]
	const picked: OrdLockFundingOutput[] = []
	let sum = 0
	for (const o of asc.reverse()) {
		picked.push(o)
		sum += o.satoshis
		if (sum >= needed) return picked
		if (picked.length >= MAX_FRONT_INPUTS) break
	}
	return null
}

/** Derive a fresh funding key and its P2PKH script + CI. */
async function newFundingScript(ctx: OneSatContext): Promise<{
	lockingScript: string
	customInstructions: string
}> {
	const keyID = `${ORDLOCK_FUNDING_KEY_PREFIX} ${randomActionId()}`
	const { publicKey } = await ctx.wallet.getPublicKey({
		protocolID: P1SAT_PROTOCOL,
		keyID,
		counterparty: 'self',
		forSelf: true,
	})
	const address = PublicKey.fromString(publicKey).toAddress()
	return {
		lockingScript: new P2PKH().lock(address).toHex(),
		customInstructions: JSON.stringify({
			protocolID: P1SAT_PROTOCOL,
			keyID,
			counterparty: 'self',
		}),
	}
}

/**
 * Preparation action: create one wallet-owned P2PKH output of `satoshis` in
 * the OrdLock funding basket. Returns its outpoint.
 */
export async function prepareOrdLockFunding(
	ctx: OneSatContext,
	satoshis: number,
	opts: Pick<
		OrdLockV2PurchaseParams,
		'fundingProvider' | 'usePermissionModule' | 'permissionScheme'
	> = {},
): Promise<{ txid: string; outpoint: string } | { error: string }> {
	const funding = await newFundingScript(ctx)
	const args: CreateActionArgs = {
		description: `Fund OrdLock purchase (${satoshis} sats)`.slice(0, 50),
		outputs: [
			{
				lockingScript: funding.lockingScript,
				satoshis,
				outputDescription: 'OrdLock purchase funding',
				basket: ORDLOCK_FUNDING_BASKET,
				tags: [ORDLOCK_FUNDING_TAG],
				customInstructions: funding.customInstructions,
			},
		],
		options: { randomizeOutputs: false },
	}
	const result = await executeTrackedAction(
		ctx.wallet,
		args,
		opts.fundingProvider,
		undefined,
		undefined,
		{
			spends: [],
			usePermissionModule: opts.usePermissionModule,
			permissionScheme: opts.permissionScheme ?? '1sat',
		},
	)
	if (result.error || !result.txid) {
		return { error: result.error ?? 'ordlock-funding-failed' }
	}
	return { txid: result.txid, outpoint: `${result.txid}.0` }
}

/**
 * Build createAction args for buying one OrdLock v2 listing in the canonical
 * layout, selecting (or preparing) front funding from the funding basket.
 */
export async function buildOrdLockV2PurchaseArgs(
	ctx: OneSatContext,
	p: OrdLockV2PurchaseParams,
): Promise<OrdLockV2PurchaseBuild | { error: string }> {
	const listing = OrdLockV2.decode(p.listingScript)
	if (!listing) return { error: 'not-an-ordlock-v2-listing' }
	if ((p.receive.satoshis ?? 0) !== 1 || !p.receive.basket) {
		return { error: 'ordlock-v2-receive-must-be-basketed-1-sat-output' }
	}
	const payout = OrdLockV2.payoutOutput(p.listingScript)
	const needed = payout.satoshis ?? 0
	const listingOutpoint = p.outpoint.replace('_', '.')

	let { outputs: candidates, beef: fundingBeef } = await loadOrdLockFunding(ctx)
	candidates = candidates.filter((c) => c.outpoint !== listingOutpoint)
	let front = selectOrdLockFunding(candidates, needed)
	let fundingTxid: string | undefined
	if (!front) {
		const prepared = await prepareOrdLockFunding(
			ctx,
			needed + Math.max(0, Math.floor(p.fundingReserve ?? 0)),
			p,
		)
		if ('error' in prepared) return prepared
		fundingTxid = prepared.txid
		const reloaded = await loadOrdLockFunding(ctx)
		fundingBeef = reloaded.beef
		const made = reloaded.outputs.find((o) => o.outpoint === prepared.outpoint)
		if (!made)
			return { error: `ordlock-funding-not-found:${prepared.outpoint}` }
		front = [made]
	}

	const cushionKey = await newFundingScript(ctx)
	const plan = OrdLockV2.planPurchase({
		frontSatoshis: front.map((f) => f.satoshis),
		listings: [p.listingScript],
		receives: [
			{
				satoshis: 1,
				lockingScript: LockingScript.fromHex(p.receive.lockingScript),
			},
		],
		cushionScript: LockingScript.fromHex(cushionKey.lockingScript),
	})

	const outputs: CreateActionOutput[] = plan.outputs.map((o, vout) => {
		if (vout === plan.cushionVout) {
			return {
				lockingScript: cushionKey.lockingScript,
				satoshis: o.satoshis ?? 0,
				outputDescription: 'OrdLock funding cushion',
				basket: ORDLOCK_FUNDING_BASKET,
				tags: [ORDLOCK_FUNDING_TAG],
				customInstructions: cushionKey.customInstructions,
			}
		}
		if (plan.fillerVouts.includes(vout)) {
			return {
				lockingScript: o.lockingScript.toHex(),
				satoshis: 0,
				outputDescription: 'OrdLock index filler',
				tags: [],
			}
		}
		if (plan.payoutVouts.includes(vout)) {
			return {
				lockingScript: o.lockingScript.toHex(),
				satoshis: o.satoshis ?? 0,
				outputDescription: 'Payment to seller',
				tags: [],
			}
		}
		return p.receive
	})
	outputs.push(...(p.extraOutputs ?? []))

	const inputs: CreateActionInput[] = front.map((f) => ({
		outpoint: f.outpoint,
		inputDescription: 'OrdLock purchase funding',
		unlockingScriptLength: unlockingScriptLengthForInstructions(
			f.customInstructions,
		),
	}))
	const listingInputIndex = inputs.length
	inputs.push({
		outpoint: listingOutpoint,
		inputDescription: 'Listed ordinal',
		unlockingScriptLength: OrdLockV2.estimatePurchaseUnlockLength(
			p.listingScript,
		),
	})

	const merged = new Beef()
	merged.mergeBeef(p.listingBeef)
	if (fundingBeef) merged.mergeBeef(fundingBeef)
	const inputBEEF = merged.toBinary()

	const spends: Spend[] = front.map((f) =>
		f.id
			? { basket: ORDLOCK_FUNDING_BASKET, id: f.id }
			: { outpoint: f.outpoint, customInstructions: f.customInstructions },
	)
	spends.push({
		outpoint: listingOutpoint,
		scheme: p.permissionScheme ?? '1sat',
	})

	const args: CreateActionArgs = {
		description: p.description.slice(0, 50),
		...(p.labels?.length && { labels: p.labels }),
		inputBEEF,
		inputs,
		outputs,
		options: { randomizeOutputs: false, trustSelf: 'known' },
	}
	return {
		args,
		spends,
		inputBEEF,
		listingInputIndex,
		receiveVout: plan.receiveVouts[0],
		cushionVout: plan.cushionVout,
		fundingTxid,
	}
}

/** Hex of the serialized payout the v2 listing demands (for logs / prompts). */
export function ordLockV2PayoutHex(listingScript: Script): string {
	const data = OrdLockV2.decode(listingScript)
	return data ? Utils.toHex(data.payout) : ''
}
