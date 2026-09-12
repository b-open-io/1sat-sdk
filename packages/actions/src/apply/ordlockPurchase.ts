/**
 * OrdLock v2 purchase apply: front funding + canonical output layout.
 *
 * The canonical batch contract binds each listing input `i` to the complete
 * output `i` (SIGHASH_SINGLE), and the listed satoshi follows first-sat
 * ordering. A purchase is therefore laid out as
 *
 * ```text
 * inputs:  0…m-1 front funding · m…m+n-1 listings   · wallet fee inputs
 * outputs: 0…m-1 cushion/fillers · m…m+n-1 payouts · receives · extras · wallet change
 * ```
 *
 * wallet-toolbox keeps explicit inputs in order, appends the funding inputs it
 * allocates after them, and appends change after the caller's outputs, but it
 * refuses to spend its own change as an explicit input. Front funding is
 * therefore a wallet-owned P2PKH output parked in the deposit basket under a
 * short `hold:` tag: an unexpired one is reused when it covers the payouts,
 * otherwise a preparation createAction on the base wallet creates one first.
 * The cushion (front funding minus payouts) goes back to the deposit basket
 * under a fresh hold, so a following purchase can reuse it and `sweepDeposit`
 * returns it to normal funding once the hold lapses.
 *
 * Actions submit the draft shape — the listing input plus the receive,
 * payout and extra outputs in any order — and this apply step rewrites it
 * after approval. In the permission-module path that means one prompt, the
 * same way the Sigma anchor is created in apply.
 */

import { OrdLockV2 } from '@1sat/templates'
import {
	DEPOSIT_BASKET,
	ORDLOCK_FUNDING_KEY_PREFIX,
	ORDLOCK_FUNDING_TAG,
	P1SAT_PROTOCOL,
	depositHoldTag,
	isDepositHeld,
} from '@1sat/types'
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
	type WalletInterface,
} from '@bsv/sdk'
import {
	type ArgsWithPendingSpends,
	PENDING_RESOLVED_SPENDS_KEY,
	type ResolvedSpend,
} from '../pipeline/spendTargets.js'
import { stampManagedOutputIds } from '../utils/createTrackedAction.js'

/** How long a prepared front-funding or cushion output is held from `sweepDeposit`. */
export const ORDLOCK_FUNDING_HOLD_MS = 5 * 60_000

/** Most front funding inputs one purchase will combine. */
const MAX_FRONT_INPUTS = 4

/** P2PKH unlock reservation for a front funding input. */
const P2PKH_UNLOCK_LENGTH = 108

/** Stash key marking args already laid out (idempotence). */
const PREPARED_KEY = '__ordlockV2Prepared' as const

const FILLER_HEX = '006a'

interface FundingCandidate {
	outpoint: string
	satoshis: number
	customInstructions: string
}

interface ListingInput {
	/** Index in the draft args.inputs */
	draftIndex: number
	outpoint: string
	lockingScript: Script
	payout: number[]
}

function bytesEqual(a: number[], b: number[]): boolean {
	if (a.length !== b.length) return false
	for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
	return true
}

function serializedOutput(o: CreateActionOutput): number[] {
	return OrdLockV2.buildOutput(
		o.satoshis,
		Utils.toArray(o.lockingScript, 'hex'),
	)
}

/** Listing inputs of the draft args, resolved against args.inputBEEF. */
function findListingInputs(args: CreateActionArgs): ListingInput[] {
	if (!args.inputs?.length || !args.inputBEEF) return []
	let beef: Beef
	try {
		beef = Beef.fromBinary(Array.from(args.inputBEEF))
	} catch {
		return []
	}
	const out: ListingInput[] = []
	args.inputs.forEach((input, draftIndex) => {
		const [txid, voutStr] = input.outpoint.replace('_', '.').split('.')
		const src = beef.findTxid(txid)?.tx?.outputs[Number(voutStr)]
		if (!src) return
		const data = OrdLockV2.decode(src.lockingScript)
		if (!data) return
		out.push({
			draftIndex,
			outpoint: `${txid}.${Number(voutStr)}`,
			lockingScript: src.lockingScript,
			payout: data.payout,
		})
	})
	return out
}

/** True when the draft args spend at least one OrdLock v2 listing and have not been laid out yet. */
export function hasUnpreparedOrdLockV2Purchase(
	args: CreateActionArgs,
): boolean {
	if ((args as CreateActionArgs & { [PREPARED_KEY]?: boolean })[PREPARED_KEY]) {
		return false
	}
	return findListingInputs(args).length > 0
}

/** Derive a fresh P1SAT funding key: P2PKH script + spend CI. */
async function fundingScript(
	wallet: WalletInterface,
	keyID: string,
): Promise<{ lockingScript: string; customInstructions: string }> {
	const { publicKey } = await wallet.getPublicKey({
		protocolID: P1SAT_PROTOCOL,
		keyID,
		counterparty: 'self',
		forSelf: true,
	})
	return {
		lockingScript: new P2PKH()
			.lock(PublicKey.fromString(publicKey).toAddress())
			.toHex(),
		customInstructions: JSON.stringify({
			protocolID: P1SAT_PROTOCOL,
			keyID,
			counterparty: 'self',
		}),
	}
}

/** Deposit-basket outputs still under hold (ours, recent), with their BEEF. */
export async function loadHeldFunding(
	wallet: WalletInterface,
	exclude: Set<string>,
	now = Date.now(),
): Promise<{ candidates: FundingCandidate[]; beef?: Beef }> {
	const res = await wallet.listOutputs({
		basket: DEPOSIT_BASKET,
		include: 'entire transactions',
		includeTags: true,
		includeCustomInstructions: true,
		limit: 200,
	})
	const beef = res.BEEF?.length
		? Beef.fromBinary(Array.from(res.BEEF))
		: undefined
	const candidates: FundingCandidate[] = []
	for (const o of res.outputs) {
		if (!o.spendable || !o.customInstructions) continue
		if (!isDepositHeld(o.tags, now)) continue
		if (exclude.has(o.outpoint)) continue
		candidates.push({
			outpoint: o.outpoint,
			satoshis: o.satoshis,
			customInstructions: o.customInstructions,
		})
	}
	return { candidates, beef }
}

/**
 * Pick front funding covering `needed`: the smallest single output that
 * covers it, else the largest few combined. null when nothing does.
 */
export function selectFrontFunding(
	candidates: FundingCandidate[],
	needed: number,
): FundingCandidate[] | null {
	const asc = [...candidates].sort((a, b) => a.satoshis - b.satoshis)
	const single = asc.find((c) => c.satoshis >= needed)
	if (single) return [single]
	const picked: FundingCandidate[] = []
	let sum = 0
	for (const c of asc.reverse()) {
		picked.push(c)
		sum += c.satoshis
		if (sum >= needed) return picked
		if (picked.length >= MAX_FRONT_INPUTS) break
	}
	return null
}

/**
 * Preparation createAction on the base wallet: one P2PKH output of `satoshis`
 * in the deposit basket under a hold. Broadcast normally, so the wallet's
 * change from it stays spendable whatever happens to the purchase.
 */
async function prepareFrontFunding(
	wallet: WalletInterface,
	keyID: string,
	satoshis: number,
	now: number,
): Promise<{ candidate: FundingCandidate; beef: Beef }> {
	const funding = await fundingScript(wallet, keyID)
	const result = await wallet.createAction({
		description: `Fund OrdLock purchase (${satoshis} sats)`.slice(0, 50),
		outputs: [
			{
				lockingScript: funding.lockingScript,
				satoshis,
				outputDescription: 'OrdLock purchase funding',
				basket: DEPOSIT_BASKET,
				tags: [
					ORDLOCK_FUNDING_TAG,
					depositHoldTag(now + ORDLOCK_FUNDING_HOLD_MS),
				],
				customInstructions: funding.customInstructions,
			},
		],
		options: { randomizeOutputs: false },
	})
	if (!result.txid || !result.tx) {
		throw new Error('ordlock.purchase apply: front funding preparation failed')
	}
	return {
		candidate: {
			outpoint: `${result.txid}.0`,
			satoshis,
			customInstructions: funding.customInstructions,
		},
		beef: Beef.fromBinary(Array.from(result.tx)),
	}
}

/**
 * Lay out an OrdLock v2 purchase. Mutates `args` in place:
 *
 * - inputs: front funding first, then the listing inputs (exact unlock
 *   reservation), then any other draft inputs;
 * - outputs: cushion / fillers, one payout per listing at its input index,
 *   the draft's basketed 1-sat receive outputs (in order, one per listing),
 *   then every other draft output;
 * - inputBEEF merged with the funding BEEF; front inputs stashed as pending
 *   resolved spends so the pipeline signs them from their CI.
 */
export async function applyOrdLockV2Purchase(
	wallet: WalletInterface,
	args: CreateActionArgs,
	now = Date.now(),
): Promise<void> {
	const listings = findListingInputs(args)
	if (listings.length === 0) return
	const draftInputs = args.inputs ?? []
	const draftOutputs = args.outputs ?? []
	const actionId = stampManagedOutputIds(args)

	// Receive outputs: basketed 1-sat outputs, in draft order, one per listing.
	const receives = draftOutputs.filter((o) => o.basket && o.satoshis === 1)
	if (receives.length !== listings.length) {
		throw new Error(
			`ordlock.purchase apply: ${listings.length} listing input(s) need ${listings.length} basketed 1-sat receive output(s), found ${receives.length}`,
		)
	}
	// Drop draft payouts (the layout re-adds each at its listing's index).
	const payoutBytes = listings.map((l) => l.payout)
	const extras = draftOutputs.filter(
		(o) =>
			!receives.includes(o) &&
			!payoutBytes.some((p) => bytesEqual(p, serializedOutput(o))),
	)

	const needed = listings.reduce(
		(sum, l) => sum + (OrdLockV2.payoutOutput(l.lockingScript).satoshis ?? 0),
		0,
	)
	const exclude = new Set(listings.map((l) => l.outpoint))
	const held = await loadHeldFunding(wallet, exclude, now)
	let front = selectFrontFunding(held.candidates, needed)
	let fundingBeef = held.beef
	if (!front) {
		const prepared = await prepareFrontFunding(
			wallet,
			`${ORDLOCK_FUNDING_KEY_PREFIX} ${actionId}`,
			needed,
			now,
		)
		front = [prepared.candidate]
		fundingBeef = prepared.beef
	}

	const cushionKey = await fundingScript(
		wallet,
		`${ORDLOCK_FUNDING_KEY_PREFIX} cushion ${actionId}`,
	)
	const plan = OrdLockV2.planPurchase({
		frontSatoshis: front.map((f) => f.satoshis),
		listings: listings.map((l) => l.lockingScript),
		receives: receives.map((r) => ({
			satoshis: 1,
			lockingScript: LockingScript.fromHex(r.lockingScript),
		})),
		cushionScript: LockingScript.fromHex(cushionKey.lockingScript),
	})

	const outputs: CreateActionOutput[] = plan.outputs.map((o, vout) => {
		if (vout === plan.cushionVout) {
			return {
				lockingScript: cushionKey.lockingScript,
				satoshis: o.satoshis ?? 0,
				outputDescription: 'OrdLock funding cushion',
				basket: DEPOSIT_BASKET,
				tags: [
					ORDLOCK_FUNDING_TAG,
					depositHoldTag(now + ORDLOCK_FUNDING_HOLD_MS),
				],
				customInstructions: cushionKey.customInstructions,
			}
		}
		if (plan.fillerVouts.includes(vout)) {
			return {
				lockingScript: FILLER_HEX,
				satoshis: 0,
				outputDescription: 'OrdLock index filler',
				tags: [],
			}
		}
		const payoutIndex = plan.payoutVouts.indexOf(vout)
		if (payoutIndex !== -1) {
			return {
				lockingScript: o.lockingScript.toHex(),
				satoshis: o.satoshis ?? 0,
				outputDescription: 'Payment to seller',
				tags: [],
			}
		}
		return receives[plan.receiveVouts.indexOf(vout)]
	})
	outputs.push(...extras)

	const inputs: CreateActionInput[] = front.map((f) => ({
		outpoint: f.outpoint,
		inputDescription: 'OrdLock purchase funding',
		unlockingScriptLength: P2PKH_UNLOCK_LENGTH,
	}))
	for (const l of listings) {
		inputs.push({
			...draftInputs[l.draftIndex],
			unlockingScriptLength: OrdLockV2.estimatePurchaseUnlockLength(
				l.lockingScript,
			),
		})
	}
	const listingDraftIndexes = new Set(listings.map((l) => l.draftIndex))
	draftInputs.forEach((i, idx) => {
		if (!listingDraftIndexes.has(idx)) inputs.push(i)
	})

	const merged = new Beef()
	if (args.inputBEEF)
		merged.mergeBeef(Beef.fromBinary(Array.from(args.inputBEEF)))
	if (fundingBeef) merged.mergeBeef(fundingBeef)

	args.inputs = inputs
	args.outputs = outputs
	args.inputBEEF = merged.toBinary()
	args.options = {
		...args.options,
		randomizeOutputs: false,
		trustSelf: 'known',
	}

	const stash = args as CreateActionArgs & ArgsWithPendingSpends
	const pending: ResolvedSpend[] = front.map((f) => ({
		outpoint: f.outpoint,
		customInstructions: f.customInstructions,
	}))
	stash[PENDING_RESOLVED_SPENDS_KEY] = [
		...(stash[PENDING_RESOLVED_SPENDS_KEY] ?? []),
		...pending,
	]
	;(args as CreateActionArgs & { [PREPARED_KEY]?: boolean })[PREPARED_KEY] =
		true
	// Re-stamp `id:` tags: the receive output moved and the cushion is new.
	stampManagedOutputIds(args)
}
