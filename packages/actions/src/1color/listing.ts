/**
 * The wallet's own 1Color outputs of one asset, read through the BRC-207
 * module's per-asset basket: `p color <assetTag>` for value,
 * `p color <assetTag> authority` for the minting capability.
 *
 * Two things the caller has to know about a basket listing, both handled here:
 *
 * - **The deploy output is in it.** BRC-162 makes an asset's first output its
 *   first token output: a fixed deploy holds the supply (value), an authority
 *   deploy holds the authority. It carries no token id (its outpoint *is* the
 *   asset id) and the module keyed it under `ISSUE`, but it spends like any
 *   other output of the basket, so it is listed with the rest.
 * - **Not everything in it is spendable.** `spendable: false` means a pending
 *   action has reserved the output. An output filed without its derivation
 *   suffix tag is worse: the module refuses to spend it at all (the tag is its
 *   index into the basket), which only matters when the output is named as an
 *   explicit input, as `burn1Color` and `endAuthority1Color` do.
 */

import { OneColor } from '@1sat/templates'
import { type TokenRole, assetBasket } from '@bsv/color-permission-module'
import { Beef, LockingScript, type WalletOutput } from '@bsv/sdk'
import type { OneSatContext } from '../types.js'

/** A BRC-207 output filed without its derivation suffix tag. */
const SUFFIX_TAG = /^p color [0-9a-f]{64}$/

const PAGE_LIMIT = 10000

/** One output of an asset this wallet holds. */
export interface ColorHolding {
	/** `<txid>.<vout>`, as BRC-36 names it */
	outpoint: string
	satoshis: number
	/** Token units; 0 for an authority output */
	amount: bigint
	/** False while a pending action holds it */
	spendable: boolean
	/** False when the module will refuse to spend it: filed without its suffix tag */
	spendableThroughModule: boolean
}

export interface ColorHoldings {
	outputs: ColorHolding[]
	/** The transactions of the listed outputs, as BEEF; only with `sources` */
	beef?: number[]
}

/** The asset an output belongs to, and its role and units; undefined for a script that is not a 1Color output. */
function readHolding(output: WalletOutput):
	| {
			assetId: string
			role: TokenRole
			amount: bigint
			outpoint: string
			satoshis: number
			spendable: boolean
			spendableThroughModule: boolean
	  }
	| undefined {
	if (typeof output.lockingScript !== 'string') return undefined
	const token = OneColor.decode(LockingScript.fromHex(output.lockingScript))
	if (!token) return undefined
	const [txid, vout] = output.outpoint.split('.')
	// A deploy output names no asset: it *is* the asset.
	const assetId =
		token.tokenId ??
		(token.role === 'deploy' ? `${txid}_${Number(vout)}` : undefined)
	if (assetId === undefined) return undefined
	const amount = token.amount
	const role: TokenRole =
		token.role === 'authority' || amount === 0n ? 'authority' : 'value'
	return {
		assetId,
		role,
		amount,
		outpoint: output.outpoint,
		satoshis: output.satoshis,
		spendable: output.spendable !== false,
		spendableThroughModule: (output.tags ?? []).some((tag) =>
			SUFFIX_TAG.test(tag),
		),
	}
}

/**
 * Every output of one asset's value or authority basket, in wallet order,
 * with the transactions that fund them when `sources` is asked for.
 */
export async function listColorHoldings(
	ctx: OneSatContext,
	assetId: string,
	role: TokenRole,
	options?: { sources?: boolean },
): Promise<ColorHoldings> {
	const basket = assetBasket(assetId, role)
	const outputs: ColorHolding[] = []
	let beef: Beef | undefined
	for (;;) {
		const page = await ctx.wallet.listOutputs({
			basket,
			include:
				options?.sources === true ? 'entire transactions' : 'locking scripts',
			includeTags: true,
			limit: PAGE_LIMIT,
			offset: outputs.length,
		})
		for (const output of page.outputs) {
			const holding = readHolding(output)
			if (holding && holding.assetId === assetId && holding.role === role) {
				outputs.push(holding)
			}
		}
		if (options?.sources === true && page.BEEF !== undefined) {
			beef = beef ?? new Beef()
			beef.mergeBeef(page.BEEF)
		}
		if (page.outputs.length < PAGE_LIMIT) {
			return {
				outputs,
				...(beef === undefined ? {} : { beef: beef.toBinary() }),
			}
		}
	}
}

/**
 * The BEEF carrying the sources of `outpoints`, from a listing made with
 * `sources`, with their proofs. An input the app names is the app's to fund:
 * the module supplies the sources of the inputs it selects itself.
 */
export function sourceBeef(
	listing: ColorHoldings,
	outpoints: string[],
): number[] {
	const beef = Beef.fromBinary(listing.beef ?? [])
	const sources = new Beef()
	for (const txid of new Set(
		outpoints.map((outpoint) => outpoint.split('.')[0] as string),
	)) {
		const source = beef.findTxid(txid)
		if (source === undefined) {
			throw new Error(`the source transaction of ${txid} is not in the listing`)
		}
		const bump = beef.findBump(txid)
		if (bump === undefined) sources.mergeBeefTx(source)
		else sources.mergeRawTx(source.rawTx ?? [], sources.mergeBump(bump))
	}
	return sources.toBinary()
}
