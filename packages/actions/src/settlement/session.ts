import { assertExactKeys } from './canonical.js'
import type {
	SettlementAssetV1,
	SettlementChain,
	SettlementOfferV1,
	SettlementPlanV1,
	SettlementTemplateV1,
} from './types.js'
import { MAX_BSV21_AMOUNT, MAX_SETTLEMENT_ASSET_INPUTS } from './types.js'
import { assertSettlementOutpoint, parseSettlementAmount } from './validate.js'

export interface SettlementSessionV1 {
	id: string
	/** Persist updates with compare-and-swap on this version. */
	version: number
	revision: number
	parties: [string, string]
	chain: SettlementChain
	builder: string
	offers: [SettlementOfferV1, SettlementOfferV1]
	maxMiningFeeSatoshis: string
	maxOverlayFeeSatoshis: string
	ready: [boolean, boolean]
	sequences: [number, number]
	phase: 'negotiating' | 'attempting' | 'reconciling' | 'settled'
	attempt: number
	/** Set BEFORE invoking any signer, including the builder funding signer. */
	signingStarted: boolean
	bitcoinAccepted: boolean
	overlayAdmitted: boolean
	receiptsInternalized: [boolean, boolean]
}

export type SettlementSessionOperationV1 = {
	sessionId: string
	actor: string
	revision: number
	/** Monotonic per actor/session; also the idempotency identity. */
	sequence: number
} & (
	| { kind: 'ready'; ready: boolean }
	| { kind: 'edit'; items: SettlementAssetV1[] }
)

export interface SettlementSessionTransitionV1 {
	state: SettlementSessionV1
	outcome:
		| 'accepted'
		| 'stale'
		| 'duplicate'
		| 'attempt-started'
		| 'already-attempting'
}

function next(value: number): number {
	if (
		!Number.isSafeInteger(value) ||
		value < 0 ||
		value === Number.MAX_SAFE_INTEGER
	)
		throw new Error('settlement-session: counter exhausted')
	return value + 1
}

function validateItems(items: SettlementAssetV1[]): void {
	if (!Array.isArray(items) || items.length > MAX_SETTLEMENT_ASSET_INPUTS)
		throw new Error('settlement-session: invalid item count')
	const seen = new Set<string>()
	for (const item of items) {
		assertExactKeys(
			item as unknown as Record<string, unknown>,
			item.kind === 'ordinal'
				? ['kind', 'outpoint']
				: item.kind === 'bsv21'
					? ['kind', 'tokenId', 'amount']
					: ['kind', 'satoshis'],
		)
		let key: string
		if (item.kind === 'ordinal') {
			assertSettlementOutpoint(item.outpoint)
			key = `ordinal:${item.outpoint}`
		} else if (item.kind === 'bsv21') {
			assertSettlementOutpoint(item.tokenId)
			parseSettlementAmount(item.amount, 'token amount', {
				max: MAX_BSV21_AMOUNT,
			})
			key = `bsv21:${item.tokenId}`
		} else if (item.kind === 'bsv') {
			parseSettlementAmount(item.satoshis, 'BSV amount', {
				max: BigInt(Number.MAX_SAFE_INTEGER),
			})
			key = 'bsv'
		} else throw new Error('settlement-session: unsupported item')
		if (seen.has(key)) throw new Error('settlement-session: duplicate item')
		seen.add(key)
	}
}

export function createSettlementSession(
	args: Pick<
		SettlementSessionV1,
		| 'id'
		| 'parties'
		| 'chain'
		| 'builder'
		| 'maxMiningFeeSatoshis'
		| 'maxOverlayFeeSatoshis'
	>,
): SettlementSessionV1 {
	if (typeof args.id !== 'string' || !args.id || args.id.length > 256)
		throw new Error('settlement-session: invalid session ID')
	if (
		args.parties.length !== 2 ||
		args.parties.some((p) => !/^(02|03)[0-9a-f]{64}$/.test(p)) ||
		args.parties[0] >= args.parties[1]
	)
		throw new Error(
			'settlement-session: parties must be distinct sorted identities',
		)
	if (
		!args.parties.includes(args.builder) ||
		!['main', 'test'].includes(args.chain)
	)
		throw new Error('settlement-session: invalid builder or chain')
	for (const limit of [args.maxMiningFeeSatoshis, args.maxOverlayFeeSatoshis])
		parseSettlementAmount(limit, 'fee limit', {
			allowZero: true,
			max: BigInt(Number.MAX_SAFE_INTEGER),
		})
	return {
		...structuredClone(args),
		version: 0,
		revision: 1,
		offers: [
			{ owner: args.parties[0], items: [] },
			{ owner: args.parties[1], items: [] },
		],
		ready: [false, false],
		sequences: [0, 0],
		phase: 'negotiating',
		attempt: 0,
		signingStarted: false,
		bitcoinAccepted: false,
		overlayAdmitted: false,
		receiptsInternalized: [false, false],
	}
}

/** Pure reducer. authenticatedActor must come from the verified transport, not the payload.
 * Persist the returned state atomically before performing any attempt side effects.
 */
export function updateSettlementSession(
	state: SettlementSessionV1,
	operation: SettlementSessionOperationV1,
	authenticatedActor: string,
): SettlementSessionTransitionV1 {
	const index = state.parties.indexOf(authenticatedActor)
	if (
		index < 0 ||
		operation.actor !== authenticatedActor ||
		operation.sessionId !== state.id
	)
		throw new Error('settlement-session: actor or session mismatch')
	if (
		!Number.isSafeInteger(operation.sequence) ||
		operation.sequence < 1 ||
		!Number.isSafeInteger(operation.revision) ||
		operation.revision < 1
	)
		throw new Error('settlement-session: invalid operation ordering')
	const unchanged = (outcome: SettlementSessionTransitionV1['outcome']) => ({
		state,
		outcome,
	})
	if (operation.sequence <= state.sequences[index])
		return unchanged('duplicate')
	if (operation.revision !== state.revision) return unchanged('stale')
	if (state.phase !== 'negotiating') return unchanged('already-attempting')
	const result = structuredClone(state)
	if (operation.kind === 'edit') {
		validateItems(operation.items)
		if (
			authenticatedActor !== state.builder &&
			operation.items.some((i) => i.kind === 'bsv')
		)
			throw new Error('settlement-session: BSV payer must be builder')
		const otherOrdinals = new Set(
			state.offers[1 - index].items
				.filter((i) => i.kind === 'ordinal')
				.map((i) => i.outpoint),
		)
		if (
			operation.items.some(
				(i) => i.kind === 'ordinal' && otherOrdinals.has(i.outpoint),
			)
		)
			throw new Error('settlement-session: duplicate ordinal')
		result.offers[index].items = structuredClone(operation.items)
		result.revision = next(state.revision)
		result.ready = [false, false]
	} else if (
		operation.kind === 'ready' &&
		typeof operation.ready === 'boolean'
	) {
		if (operation.ready && state.offers.some((o) => o.items.length === 0))
			throw new Error('settlement-session: both offers must be nonempty')
		result.ready[index] = operation.ready
	} else throw new Error('settlement-session: invalid operation')
	result.sequences[index] = operation.sequence
	result.version = next(state.version)
	if (result.ready.every(Boolean)) {
		result.phase = 'attempting'
		result.attempt = next(state.attempt)
		result.signingStarted = false
		result.bitcoinAccepted = false
		result.overlayAdmitted = !result.offers.some((o) =>
			o.items.some((i) => i.kind === 'bsv21'),
		)
		result.receiptsInternalized = [false, false]
		return { state: result, outcome: 'attempt-started' }
	}
	return { state: result, outcome: 'accepted' }
}

export type SettlementAttemptEventV1 =
	| {
			sessionId: string
			attempt: number
			kind:
				| 'signing-started'
				| 'failed'
				| 'candidate-invalidated'
				| 'bitcoin-accepted'
				| 'overlay-admitted'
	  }
	| {
			sessionId: string
			attempt: number
			kind: 'receipt-internalized'
			owner: string
	  }

/** Trusted local lifecycle events, never commands accepted directly from a peer.
 * candidate-invalidated requires independent evidence that the old candidate cannot settle.
 */
export function advanceSettlementAttempt(
	state: SettlementSessionV1,
	event: SettlementAttemptEventV1,
): SettlementSessionV1 {
	if (
		event.sessionId !== state.id ||
		event.attempt !== state.attempt ||
		!['attempting', 'reconciling'].includes(state.phase)
	)
		throw new Error('settlement-session: inactive or substituted attempt')
	const result = structuredClone(state)
	const reopen = () => {
		result.revision = next(state.revision)
		result.phase = 'negotiating'
		result.ready = [false, false]
		result.signingStarted = false
		result.bitcoinAccepted = false
		result.overlayAdmitted = false
		result.receiptsInternalized = [false, false]
	}
	switch (event.kind) {
		case 'signing-started':
			if (state.phase !== 'attempting')
				throw new Error('settlement-session: cannot sign unresolved attempt')
			result.signingStarted = true
			break
		case 'failed':
			if (state.signingStarted || state.bitcoinAccepted)
				result.phase = 'reconciling'
			else reopen()
			break
		case 'candidate-invalidated':
			if (state.bitcoinAccepted || state.phase !== 'reconciling')
				throw new Error(
					'settlement-session: cannot invalidate accepted or active candidate',
				)
			reopen()
			break
		case 'bitcoin-accepted':
			result.bitcoinAccepted = true
			break
		case 'overlay-admitted':
			result.overlayAdmitted = true
			break
		case 'receipt-internalized': {
			const index = state.parties.indexOf(event.owner)
			if (index < 0 || !state.bitcoinAccepted)
				throw new Error('settlement-session: invalid receipt event')
			result.receiptsInternalized[index] = true
			break
		}
		default:
			throw new Error('settlement-session: invalid lifecycle event')
	}
	if (
		result.bitcoinAccepted &&
		result.overlayAdmitted &&
		result.receiptsInternalized.every(Boolean)
	)
		result.phase = 'settled'
	result.version = next(state.version)
	return result
}

/** Bind a locally validated plan to the frozen user-approved offers. */
export function assertSettlementSessionPlan(
	state: SettlementSessionV1,
	plan: SettlementPlanV1,
): void {
	if (state.phase !== 'attempting' || !state.ready.every(Boolean))
		throw new Error('settlement-session: no confirmed attempt')
	// Compare semantic item fields, not object property insertion order.
	const normalize = (offers: SettlementOfferV1[]) =>
		offers.map((o) => [
			o.owner,
			o.items.map((i) =>
				i.kind === 'ordinal'
					? [i.kind, i.outpoint]
					: i.kind === 'bsv21'
						? [i.kind, i.tokenId, i.amount]
						: [i.kind, i.satoshis],
			),
		])
	if (
		state.chain !== plan.chain ||
		state.builder !== plan.builder ||
		JSON.stringify(state.parties) !== JSON.stringify(plan.parties) ||
		JSON.stringify(normalize(state.offers)) !==
			JSON.stringify(normalize(plan.offers))
	)
		throw new Error('settlement-session: plan differs from confirmed terms')
}

/** Call after reconstructing the candidate and before any signing or finalization. */
export function assertSettlementSessionFees(
	state: SettlementSessionV1,
	template: SettlementTemplateV1,
): void {
	const manifest = template.manifest
	const miningFee =
		manifest.inputs.reduce((n, i) => n + BigInt(i.sourceSatoshis), 0n) -
		manifest.outputs.reduce((n, o) => n + BigInt(o.satoshis), 0n)
	const overlayFee = manifest.outputs
		.filter((o) => o.purpose === 'overlay-fee')
		.reduce((n, o) => n + BigInt(o.satoshis), 0n)
	if (
		miningFee <= 0n ||
		miningFee > BigInt(state.maxMiningFeeSatoshis) ||
		overlayFee > BigInt(state.maxOverlayFeeSatoshis)
	)
		throw new Error('settlement-session: fee exceeds confirmed limits')
}
