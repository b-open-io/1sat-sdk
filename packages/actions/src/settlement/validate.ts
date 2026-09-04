import { assertExactKeys, digestSettlementObject } from './canonical.js'
import type {
	Bsv21TipCandidateV1,
	LockedOfferCommitmentV1,
	LockedOfferItemV1,
	SelectedBsv21TipsV1,
	SettlementContributionV1,
	SettlementPlanV1,
} from './types.js'
import {
	MAX_BSV21_AMOUNT,
	MAX_SETTLEMENT_ASSET_INPUTS,
	MAX_SETTLEMENT_BEEF_BYTES,
	MAX_SETTLEMENT_OUTPUTS,
	MAX_SETTLEMENT_SCRIPT_BYTES,
	SETTLEMENT_PROTOCOL,
	SETTLEMENT_VERSION,
} from './types.js'

const HEX_64 = /^[0-9a-f]{64}$/
const COMPRESSED_KEY = /^(02|03)[0-9a-f]{64}$/
const DECIMAL = /^(0|[1-9][0-9]*)$/
const POSITIVE_DECIMAL = /^[1-9][0-9]*$/
const OUTPOINT = /^([0-9a-f]{64})_(0|[1-9][0-9]*)$/
const HASH = /^[0-9a-f]{64}$/
const LOWER_HEX = /^(?:[0-9a-f]{2})+$/

export function assertSettlementOutpoint(
	value: string,
	context = 'outpoint',
): void {
	if (!OUTPOINT.test(value))
		throw new Error(`${context}: noncanonical outpoint`)
}

export function assertTokenId(value: string, context = 'tokenId'): void {
	assertSettlementOutpoint(value, context)
}

export function parseSettlementAmount(
	value: string,
	context: string,
	options: { allowZero?: boolean; max?: bigint } = {},
): bigint {
	const pattern = options.allowZero ? DECIMAL : POSITIVE_DECIMAL
	if (!pattern.test(value)) throw new Error(`${context}: noncanonical amount`)
	const amount = BigInt(value)
	if (options.max !== undefined && amount > options.max) {
		throw new Error(`${context}: amount exceeds uint64`)
	}
	return amount
}

function assertIdentity(value: string, context: string): void {
	if (!COMPRESSED_KEY.test(value)) {
		throw new Error(`${context}: identity must be lowercase compressed SEC hex`)
	}
}

function assertSafeTime(value: number, context: string): void {
	if (!Number.isSafeInteger(value) || value < 0) {
		throw new Error(`${context}: expected nonnegative safe integer`)
	}
}

function assertOfferItem(item: LockedOfferItemV1, context: string): void {
	const record = item as unknown as Record<string, unknown>
	if (item.kind === 'ordinal') {
		assertExactKeys(record, ['kind', 'outpoint'], [], context)
		assertSettlementOutpoint(item.outpoint, `${context}.outpoint`)
		return
	}
	if (item.kind === 'bsv21') {
		assertExactKeys(record, ['kind', 'tokenId', 'amount'], [], context)
		assertTokenId(item.tokenId, `${context}.tokenId`)
		parseSettlementAmount(item.amount, `${context}.amount`, {
			max: MAX_BSV21_AMOUNT,
		})
		return
	}
	if (item.kind === 'bsv') {
		assertExactKeys(record, ['kind', 'satoshis'], [], context)
		parseSettlementAmount(item.satoshis, `${context}.satoshis`)
		return
	}
	throw new Error(`${context}: unsupported offer item`)
}

export function validateLockedOffer(
	offer: LockedOfferCommitmentV1,
	now = Date.now(),
): LockedOfferCommitmentV1 {
	assertSafeTime(now, 'now')
	assertExactKeys(
		offer as unknown as Record<string, unknown>,
		[
			'protocol',
			'version',
			'chain',
			'sessionId',
			'parties',
			'offers',
			'builder',
			'feePayer',
			'expiresAt',
		],
		[],
		'lockedOffer',
	)
	if (
		offer.protocol !== SETTLEMENT_PROTOCOL ||
		offer.version !== SETTLEMENT_VERSION
	) {
		throw new Error('lockedOffer: unsupported protocol or version')
	}
	if (offer.chain !== 'main' && offer.chain !== 'test') {
		throw new Error('lockedOffer: invalid chain')
	}
	if (!offer.sessionId) throw new Error('lockedOffer: empty sessionId')
	if (!Array.isArray(offer.parties) || offer.parties.length !== 2) {
		throw new Error('lockedOffer: exactly two parties required')
	}
	for (const [index, party] of offer.parties.entries()) {
		assertIdentity(party, `lockedOffer.parties[${index}]`)
	}
	if (offer.parties[0] >= offer.parties[1]) {
		throw new Error(
			'lockedOffer: parties must be unique and lexicographically sorted',
		)
	}
	assertIdentity(offer.builder, 'lockedOffer.builder')
	if (!offer.parties.includes(offer.builder)) {
		throw new Error('lockedOffer: builder is not a participant')
	}
	if (offer.builder !== offer.feePayer) {
		throw new Error('lockedOffer: builder and feePayer must match')
	}
	assertSafeTime(offer.expiresAt, 'lockedOffer.expiresAt')
	if (offer.expiresAt <= now) throw new Error('lockedOffer: expired')
	if (!Array.isArray(offer.offers) || offer.offers.length !== 2) {
		throw new Error('lockedOffer: exactly two owner offers required')
	}

	const ordinalOutpoints = new Set<string>()
	const seenOwners = new Set<string>()
	for (const [offerIndex, ownerOffer] of offer.offers.entries()) {
		const context = `lockedOffer.offers[${offerIndex}]`
		assertExactKeys(
			ownerOffer as unknown as Record<string, unknown>,
			['owner', 'revision', 'items'],
			[],
			context,
		)
		assertIdentity(ownerOffer.owner, `${context}.owner`)
		if (
			!offer.parties.includes(ownerOffer.owner) ||
			seenOwners.has(ownerOffer.owner)
		) {
			throw new Error(
				`${context}: owner missing, duplicated, or not a participant`,
			)
		}
		seenOwners.add(ownerOffer.owner)
		if (!Number.isSafeInteger(ownerOffer.revision) || ownerOffer.revision < 0) {
			throw new Error(`${context}: invalid revision`)
		}
		if (!Array.isArray(ownerOffer.items) || ownerOffer.items.length === 0) {
			throw new Error(`${context}: at least one item required`)
		}
		if (ownerOffer.items.length > MAX_SETTLEMENT_ASSET_INPUTS) {
			throw new Error(`${context}: too many asset items`)
		}
		const ownerTokenIds = new Set<string>()
		let ownerBsv = false
		for (const [itemIndex, item] of ownerOffer.items.entries()) {
			assertOfferItem(item, `${context}.items[${itemIndex}]`)
			if (item.kind === 'ordinal') {
				if (ordinalOutpoints.has(item.outpoint)) {
					throw new Error('lockedOffer: duplicate ordinal outpoint')
				}
				ordinalOutpoints.add(item.outpoint)
			} else if (item.kind === 'bsv21') {
				if (ownerTokenIds.has(item.tokenId)) {
					throw new Error('lockedOffer: duplicate owner/token BSV21 leg')
				}
				ownerTokenIds.add(item.tokenId)
			} else {
				if (ownerBsv) throw new Error('lockedOffer: duplicate BSV leg')
				ownerBsv = true
				if (ownerOffer.owner !== offer.builder) {
					throw new Error('lockedOffer: BSV payer must be the builder')
				}
			}
		}
	}
	if (offer.offers[0].owner >= offer.offers[1].owner) {
		throw new Error('lockedOffer: offers must be sorted by owner')
	}
	return offer
}

export function lockedOfferDigest(
	offer: LockedOfferCommitmentV1,
	now = Date.now(),
): string {
	return digestSettlementObject(validateLockedOffer(offer, now))
}

export function selectBsv21Tips(
	tokenId: string,
	requestedAmount: string,
	candidates: readonly Bsv21TipCandidateV1[],
	options: { now?: number; maxEvidenceAgeMs: number },
): SelectedBsv21TipsV1 {
	assertTokenId(tokenId)
	const requested = parseSettlementAmount(requestedAmount, 'requestedAmount', {
		max: MAX_BSV21_AMOUNT,
	})
	const now = options.now ?? Date.now()
	assertSafeTime(now, 'now')
	if (
		!Number.isSafeInteger(options.maxEvidenceAgeMs) ||
		options.maxEvidenceAgeMs < 0
	) {
		throw new Error('selectBsv21Tips: invalid evidence age')
	}
	const candidateOutpoints = new Set<string>()
	const eligible = candidates.map((candidate, index) => {
		assertSettlementOutpoint(
			candidate.outpoint,
			`candidates[${index}].outpoint`,
		)
		assertTokenId(candidate.tokenId, `candidates[${index}].tokenId`)
		if (candidateOutpoints.has(candidate.outpoint)) {
			throw new Error('selectBsv21Tips: duplicate candidate outpoint')
		}
		candidateOutpoints.add(candidate.outpoint)
		if (candidate.tokenId !== tokenId)
			throw new Error('selectBsv21Tips: wrong token ID')
		if (candidate.operation !== 'transfer') {
			throw new Error(`selectBsv21Tips: forbidden ${candidate.operation} input`)
		}
		if (candidate.active !== true || candidate.unspent !== true) {
			throw new Error('selectBsv21Tips: inactive or spent input')
		}
		assertSafeTime(
			candidate.statusCheckedAt,
			`candidates[${index}].statusCheckedAt`,
		)
		if (
			candidate.statusCheckedAt > now ||
			now - candidate.statusCheckedAt > options.maxEvidenceAgeMs
		) {
			throw new Error('selectBsv21Tips: stale status evidence')
		}
		const amount = parseSettlementAmount(
			candidate.amount,
			`candidates[${index}].amount`,
			{
				max: MAX_BSV21_AMOUNT,
			},
		)
		parseSettlementAmount(
			candidate.sourceSatoshis,
			`candidates[${index}].sourceSatoshis`,
		)
		if (
			!HASH.test(candidate.sourceScriptHash) ||
			!HASH.test(candidate.sourceBeefHash)
		) {
			throw new Error('selectBsv21Tips: malformed source commitment')
		}
		return { candidate, amount }
	})
	eligible.sort((a, b) => {
		if (a.amount !== b.amount) return a.amount > b.amount ? -1 : 1
		return a.candidate.outpoint.localeCompare(b.candidate.outpoint)
	})
	const selected: Bsv21TipCandidateV1[] = []
	let total = 0n
	for (const { candidate, amount } of eligible) {
		if (total >= requested) break
		if (total > MAX_BSV21_AMOUNT - amount) {
			throw new Error('selectBsv21Tips: uint64 overflow')
		}
		total += amount
		selected.push(candidate)
	}
	if (total < requested)
		throw new Error('selectBsv21Tips: insufficient active balance')
	return {
		tokenId,
		requestedAmount: requested.toString(),
		selectedAmount: total.toString(),
		changeAmount: (total - requested).toString(),
		tips: selected,
	}
}

function validateContribution(
	contribution: SettlementContributionV1,
	plan: SettlementPlanV1,
	now: number,
	maxEvidenceAgeMs: number,
): void {
	assertExactKeys(
		contribution as unknown as Record<string, unknown>,
		['owner', 'offerDigest', 'inputs', 'destinations'],
		[],
		'contribution',
	)
	if (!plan.lockedOffer.parties.includes(contribution.owner)) {
		throw new Error('settlementPlan: contribution owner is not a participant')
	}
	if (contribution.offerDigest !== plan.offerDigest) {
		throw new Error('settlementPlan: contribution offer digest mismatch')
	}
	const outpoints = new Set<string>()
	for (const input of contribution.inputs) {
		assertExactKeys(
			input as unknown as Record<string, unknown>,
			[
				'outpoint',
				'owner',
				'purpose',
				'sourceSatoshis',
				'sourceScriptHash',
				'sourceBeefHash',
				'active',
				'unspent',
				'statusCheckedAt',
			],
			['tokenId', 'tokenAmount', 'operation'],
			'contribution.input',
		)
		assertSettlementOutpoint(input.outpoint)
		if (input.owner !== contribution.owner) {
			throw new Error('settlementPlan: input owner substitution')
		}
		if (outpoints.has(input.outpoint))
			throw new Error('settlementPlan: duplicate input')
		outpoints.add(input.outpoint)
		if (input.active !== true || input.unspent !== true) {
			throw new Error('settlementPlan: spent or inactive input')
		}
		assertSafeTime(input.statusCheckedAt, 'input.statusCheckedAt')
		if (
			input.statusCheckedAt > now ||
			now - input.statusCheckedAt > maxEvidenceAgeMs
		) {
			throw new Error('settlementPlan: stale input evidence')
		}
		parseSettlementAmount(input.sourceSatoshis, 'input.sourceSatoshis', {
			max: BigInt(Number.MAX_SAFE_INTEGER),
		})
		if (
			!HASH.test(input.sourceScriptHash) ||
			!HASH.test(input.sourceBeefHash)
		) {
			throw new Error('settlementPlan: malformed source commitment')
		}
		if (input.purpose === 'bsv21') {
			if (!input.tokenId || !input.tokenAmount) {
				throw new Error('settlementPlan: incomplete BSV21 input')
			}
			assertTokenId(input.tokenId)
			parseSettlementAmount(input.tokenAmount, 'input.tokenAmount', {
				max: MAX_BSV21_AMOUNT,
			})
			if (input.operation !== 'transfer') {
				throw new Error(
					'settlementPlan: only BSV21 transfer inputs are permitted',
				)
			}
		} else if (input.tokenId || input.tokenAmount || input.operation) {
			throw new Error('settlementPlan: ordinal input carries token fields')
		}
	}
	for (const destination of contribution.destinations) {
		assertExactKeys(
			destination as unknown as Record<string, unknown>,
			['legIndex', 'owner', 'purpose', 'lockingScript', 'satoshis'],
			['tokenId', 'tokenAmount', 'sourceOrdinal'],
			'contribution.destination',
		)
		if (
			!Number.isSafeInteger(destination.legIndex) ||
			destination.legIndex < 0
		) {
			throw new Error('settlementPlan: invalid destination leg index')
		}
		if (!plan.lockedOffer.parties.includes(destination.owner)) {
			throw new Error('settlementPlan: destination owner substitution')
		}
		if (!LOWER_HEX.test(destination.lockingScript)) {
			throw new Error('settlementPlan: malformed destination script')
		}
		if (destination.lockingScript.length / 2 > MAX_SETTLEMENT_SCRIPT_BYTES) {
			throw new Error('settlementPlan: destination script exceeds size limit')
		}
		parseSettlementAmount(destination.satoshis, 'destination.satoshis', {
			max: BigInt(Number.MAX_SAFE_INTEGER),
		})
		if (destination.purpose.startsWith('bsv21')) {
			if (!destination.tokenId || !destination.tokenAmount) {
				throw new Error('settlementPlan: incomplete BSV21 destination')
			}
			assertTokenId(destination.tokenId)
			parseSettlementAmount(
				destination.tokenAmount,
				'destination.tokenAmount',
				{
					max: MAX_BSV21_AMOUNT,
				},
			)
			if (destination.satoshis !== '1' || destination.sourceOrdinal) {
				throw new Error('settlementPlan: invalid BSV21 destination fields')
			}
		} else if (destination.tokenId || destination.tokenAmount) {
			throw new Error(
				'settlementPlan: non-token destination carries token fields',
			)
		} else if (
			destination.purpose === 'ordinal-receipt' &&
			!destination.sourceOrdinal
		) {
			throw new Error('settlementPlan: ordinal receipt missing source outpoint')
		} else if (
			destination.purpose !== 'ordinal-receipt' &&
			destination.sourceOrdinal
		) {
			throw new Error(
				'settlementPlan: non-ordinal destination carries source ordinal',
			)
		}
	}
}

/** Structural and economic validation before the builder asks its wallet to fund. */
export function validateSettlementPlan(
	plan: SettlementPlanV1,
	options: { now?: number; maxEvidenceAgeMs: number },
): SettlementPlanV1 {
	const now = options.now ?? Date.now()
	assertSafeTime(now, 'now')
	assertExactKeys(
		plan as unknown as Record<string, unknown>,
		[
			'lockedOffer',
			'offerDigest',
			'settlementId',
			'attempt',
			'contributions',
			'overlayPolicies',
			'sourceBEEFs',
		],
		[],
		'settlementPlan',
	)
	validateLockedOffer(plan.lockedOffer, now)
	if (lockedOfferDigest(plan.lockedOffer, now) !== plan.offerDigest) {
		throw new Error('settlementPlan: locked offer digest mismatch')
	}
	if (!plan.settlementId) throw new Error('settlementPlan: empty settlement ID')
	if (!Number.isSafeInteger(plan.attempt) || plan.attempt < 1) {
		throw new Error('settlementPlan: invalid attempt')
	}
	if (plan.contributions.length !== 2) {
		throw new Error('settlementPlan: exactly two contributions required')
	}
	const inputCount = plan.contributions.reduce(
		(total, contribution) => total + contribution.inputs.length,
		0,
	)
	const destinationCount = plan.contributions.reduce(
		(total, contribution) => total + contribution.destinations.length,
		0,
	)
	if (inputCount > MAX_SETTLEMENT_ASSET_INPUTS) {
		throw new Error('settlementPlan: too many asset inputs')
	}
	if (destinationCount > MAX_SETTLEMENT_OUTPUTS) {
		throw new Error('settlementPlan: too many destinations')
	}
	if (plan.overlayPolicies.length > MAX_SETTLEMENT_ASSET_INPUTS) {
		throw new Error('settlementPlan: too many overlay policies')
	}
	if (plan.sourceBEEFs.length > MAX_SETTLEMENT_ASSET_INPUTS) {
		throw new Error('settlementPlan: too many source BEEFs')
	}
	if (plan.contributions[0].owner >= plan.contributions[1].owner) {
		throw new Error('settlementPlan: contributions must be sorted by owner')
	}
	for (const contribution of plan.contributions) {
		validateContribution(contribution, plan, now, options.maxEvidenceAgeMs)
	}
	let totalSourceBeefBytes = 0
	for (const [index, source] of plan.sourceBEEFs.entries()) {
		assertExactKeys(
			source as unknown as Record<string, unknown>,
			['hash', 'beef'],
			[],
			`sourceBEEFs[${index}]`,
		)
		assertHex64(source.hash, `sourceBEEFs[${index}].hash`)
		if (!Array.isArray(source.beef) || source.beef.length === 0) {
			throw new Error('settlementPlan: empty source BEEF')
		}
		if (source.beef.length > MAX_SETTLEMENT_BEEF_BYTES) {
			throw new Error('settlementPlan: source BEEF exceeds size limit')
		}
		totalSourceBeefBytes += source.beef.length
		if (totalSourceBeefBytes > MAX_SETTLEMENT_BEEF_BYTES) {
			throw new Error('settlementPlan: source BEEFs exceed size limit')
		}
	}
	for (const [index, policy] of plan.overlayPolicies.entries()) {
		assertExactKeys(
			policy as unknown as Record<string, unknown>,
			[
				'tokenId',
				'statusCheckedAt',
				'feeAddress',
				'feeLockingScript',
				'feePerOutput',
			],
			[],
			`overlayPolicies[${index}]`,
		)
		if (
			index > 0 &&
			plan.overlayPolicies[index - 1].tokenId >= policy.tokenId
		) {
			throw new Error(
				'settlementPlan: overlay policies must be unique and sorted',
			)
		}
	}

	const allInputs = plan.contributions.flatMap(
		(contribution) => contribution.inputs,
	)
	const allDestinations = plan.contributions.flatMap(
		(contribution) => contribution.destinations,
	)
	const inputOutpoints = new Set<string>()
	for (const input of allInputs) {
		if (inputOutpoints.has(input.outpoint))
			throw new Error('settlementPlan: duplicate asset input')
		inputOutpoints.add(input.outpoint)
	}

	for (const ownerOffer of plan.lockedOffer.offers) {
		const recipient = plan.lockedOffer.parties.find(
			(party) => party !== ownerOffer.owner,
		)!
		for (const [legIndex, item] of ownerOffer.items.entries()) {
			if (item.kind === 'ordinal') {
				const inputs = allInputs.filter(
					(input) =>
						input.owner === ownerOffer.owner &&
						input.purpose === 'ordinal' &&
						input.outpoint === item.outpoint,
				)
				if (inputs.length !== 1)
					throw new Error('settlementPlan: missing or duplicate ordinal input')
				const outputs = allDestinations.filter(
					(output) =>
						output.legIndex === legIndex &&
						output.owner === recipient &&
						output.purpose === 'ordinal-receipt' &&
						output.sourceOrdinal === item.outpoint,
				)
				if (outputs.length !== 1) {
					throw new Error(
						'settlementPlan: missing or substituted ordinal receipt',
					)
				}
				if (outputs[0].satoshis !== inputs[0].sourceSatoshis) {
					throw new Error(
						'settlementPlan: ordinal receipt must preserve the source satoshi span',
					)
				}
			} else if (item.kind === 'bsv21') {
				const inputs = allInputs.filter(
					(input) =>
						input.owner === ownerOffer.owner &&
						input.purpose === 'bsv21' &&
						input.tokenId === item.tokenId,
				)
				let total = 0n
				for (const input of inputs) {
					const amount = parseSettlementAmount(
						input.tokenAmount!,
						'input.tokenAmount',
						{
							max: MAX_BSV21_AMOUNT,
						},
					)
					if (total > MAX_BSV21_AMOUNT - amount)
						throw new Error('settlementPlan: uint64 overflow')
					total += amount
				}
				const offered = parseSettlementAmount(item.amount, 'offer.amount', {
					max: MAX_BSV21_AMOUNT,
				})
				if (total < offered)
					throw new Error('settlementPlan: insufficient BSV21 inputs')
				const receipts = allDestinations.filter(
					(output) =>
						output.legIndex === legIndex &&
						output.owner === recipient &&
						output.purpose === 'bsv21-receipt' &&
						output.tokenId === item.tokenId,
				)
				if (
					receipts.length !== 1 ||
					receipts[0].tokenAmount !== offered.toString()
				) {
					throw new Error('settlementPlan: BSV21 receipt mismatch')
				}
				const expectedChange = total - offered
				const changes = allDestinations.filter(
					(output) =>
						output.legIndex === legIndex &&
						output.owner === ownerOffer.owner &&
						output.purpose === 'bsv21-change' &&
						output.tokenId === item.tokenId,
				)
				if (
					expectedChange === 0n ? changes.length !== 0 : changes.length !== 1
				) {
					throw new Error('settlementPlan: missing or excess BSV21 change')
				}
				if (
					changes[0] &&
					changes[0].tokenAmount !== expectedChange.toString()
				) {
					throw new Error('settlementPlan: incorrect BSV21 change amount')
				}
			} else {
				const payments = allDestinations.filter(
					(output) =>
						output.legIndex === legIndex &&
						output.owner === recipient &&
						output.purpose === 'bsv-payment',
				)
				if (payments.length !== 1 || payments[0].satoshis !== item.satoshis) {
					throw new Error('settlementPlan: BSV payment mismatch')
				}
			}
		}
	}
	for (const input of allInputs) {
		const ownerOffer = plan.lockedOffer.offers.find(
			(offer) => offer.owner === input.owner,
		)!
		const agreed = ownerOffer.items.some((item) =>
			input.purpose === 'ordinal'
				? item.kind === 'ordinal' && item.outpoint === input.outpoint
				: item.kind === 'bsv21' && item.tokenId === input.tokenId,
		)
		if (!agreed) throw new Error('settlementPlan: unagreed asset input')
	}

	const expectedDestinations = plan.lockedOffer.offers.reduce(
		(count, ownerOffer) =>
			count +
			ownerOffer.items.length +
			ownerOffer.items.filter((item) => {
				if (item.kind !== 'bsv21') return false
				const inputAmount = allInputs
					.filter(
						(input) =>
							input.owner === ownerOffer.owner &&
							input.tokenId === item.tokenId,
					)
					.reduce((sum, input) => sum + BigInt(input.tokenAmount!), 0n)
				return inputAmount > BigInt(item.amount)
			}).length,
		0,
	)
	if (allDestinations.length !== expectedDestinations) {
		throw new Error('settlementPlan: extra or unknown destination')
	}
	return plan
}

export function assertHex64(value: string, context: string): void {
	if (!HEX_64.test(value))
		throw new Error(`${context}: expected lowercase 32-byte hash`)
}
