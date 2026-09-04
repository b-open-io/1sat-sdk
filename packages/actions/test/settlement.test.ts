import { describe, expect, test } from 'bun:test'
import { BSV21, Inscription } from '@1sat/templates'
import {
	Beef,
	BigNumber,
	type CreateActionArgs,
	type CreateActionResult,
	ECDSA,
	Hash,
	LockingScript,
	P2PKH,
	PrivateKey,
	Transaction,
	UnlockingScript,
	Utils,
	type WalletInterface,
} from '@bsv/sdk'
import {
	InMemorySettlementReplayStore,
	type LockedOfferCommitmentV1,
	MAX_BSV21_AMOUNT,
	type OverlayPolicyV1,
	SETTLEMENT_PROTOCOL,
	SETTLEMENT_SIGHASH_SCOPE,
	SETTLEMENT_VERSION,
	type SettlementAssetInputV1,
	type SettlementContributionV1,
	type SettlementDestinationV1,
	type SettlementPlanV1,
	type SettlementReservationAdapter,
	assertExactKeys,
	authorizeSettlementInputs,
	canonicalizeSettlementJson,
	createSettlementSigningRequest,
	digestSettlementObject,
	finalizeSettlementAction,
	hashSettlementBytes,
	lockedOfferDigest,
	prepareSettlementAction,
	reconstructSettlementTemplate,
	recordSettlementArtifact,
	reserveSettlementInputs,
	selectBsv21Tips,
	settlementContributionDigest,
	validateLockedOffer,
	validateSettlementPlan,
} from '../src/settlement'

const NOW = 1_800_000_000_000
const EXPIRES = NOW + 60_000
const MAX_AGE = 5_000
const TOKEN_1 = `${'1'.repeat(64)}_0`
const TOKEN_2 = `${'2'.repeat(64)}_0`
const KEY_A = PrivateKey.fromString('1'.padStart(64, '0'), 16)
const KEY_B = PrivateKey.fromString('2'.padStart(64, '0'), 16)
const KEY_FUNDING = PrivateKey.fromString('3'.padStart(64, '0'), 16)
const KEY_FEE = PrivateKey.fromString('4'.padStart(64, '0'), 16)
const PARTY_A = Utils.toHex(KEY_A.toPublicKey().encode(true) as number[])
const PARTY_B = Utils.toHex(KEY_B.toPublicKey().encode(true) as number[])
const PARTIES = [PARTY_A, PARTY_B].sort() as [string, string]

function p2pkh(key: PrivateKey): string {
	return new P2PKH().lock(key.toAddress()).toHex()
}

function sourceTransaction(lockingScript: string, satoshis = 1): Transaction {
	const tx = new Transaction()
	tx.addInput({
		sourceTXID: '0'.repeat(64),
		sourceOutputIndex: 0,
		unlockingScript: new UnlockingScript(),
		sequence: 0xffffffff,
	})
	tx.addOutput({
		lockingScript: LockingScript.fromHex(lockingScript),
		satoshis,
	})
	return tx
}

function sourceBeef(transactions: Transaction[]): {
	hash: string
	beef: number[]
} {
	const beef = new Beef()
	for (const transaction of transactions) beef.mergeTransaction(transaction)
	const binary = beef.toBinary()
	return { hash: hashSettlementBytes(binary), beef: binary }
}

function assetInput(
	tx: Transaction,
	owner: string,
	purpose: 'ordinal' | 'bsv21',
	sourceHash: string,
	token?: { id: string; amount: string },
): SettlementAssetInputV1 {
	const output = tx.outputs[0]
	return {
		outpoint: `${tx.id('hex')}_0`,
		owner,
		purpose,
		...(token ? { tokenId: token.id, tokenAmount: token.amount } : {}),
		sourceSatoshis: String(output.satoshis),
		sourceScriptHash: Utils.toHex(Hash.sha256(output.lockingScript.toBinary())),
		sourceBeefHash: sourceHash,
		active: true,
		unspent: true,
		statusCheckedAt: NOW - 100,
		...(purpose === 'bsv21' ? { operation: 'transfer' as const } : {}),
	}
}

function destination(
	values: Omit<
		SettlementDestinationV1,
		'destinationProof' | 'destinationVerified'
	>,
): SettlementDestinationV1 {
	return { ...values, destinationProof: 'proof', destinationVerified: true }
}

function overlayPolicy(tokenId: string, feePerOutput: string): OverlayPolicyV1 {
	return {
		tokenId,
		statusCheckedAt: NOW - 100,
		feeAddress: KEY_FEE.toAddress(),
		feeLockingScript: p2pkh(KEY_FEE),
		feePerOutput,
	}
}

function lockedOffer(
	offers: LockedOfferCommitmentV1['offers'],
): LockedOfferCommitmentV1 {
	return {
		protocol: SETTLEMENT_PROTOCOL,
		version: SETTLEMENT_VERSION,
		chain: 'main',
		sessionId: 'session-vector',
		parties: PARTIES,
		offers: [...offers].sort((a, b) => a.owner.localeCompare(b.owner)),
		builder: PARTY_A,
		feePayer: PARTY_A,
		expiresAt: EXPIRES,
	}
}

function planFor(
	offer: LockedOfferCommitmentV1,
	inputs: SettlementAssetInputV1[],
	destinations: SettlementDestinationV1[],
	sources: Array<{ hash: string; beef: number[] }>,
	policies: OverlayPolicyV1[],
): SettlementPlanV1 {
	const digest = lockedOfferDigest(offer, NOW)
	const contributions = PARTIES.map((owner) => {
		const contribution = {
			owner,
			offerDigest: digest,
			reservationId: `lease-${owner.slice(0, 8)}`,
			reservationExpiresAt: EXPIRES,
			inputs: inputs.filter((input) => input.owner === owner),
			destinations: destinations.filter((output) => output.owner === owner),
		}
		return {
			...contribution,
			contributionHash: settlementContributionDigest(contribution),
		}
	}) as [SettlementContributionV1, SettlementContributionV1]
	return {
		lockedOffer: offer,
		offerDigest: digest,
		settlementId: 'settlement-vector',
		attempt: 1,
		contributions,
		overlayPolicies: policies,
		sourceBEEFs: sources,
	}
}

function rehashPlanContributions(plan: SettlementPlanV1): void {
	for (const contribution of plan.contributions) {
		const { contributionHash: _oldHash, ...body } = contribution
		contribution.contributionHash = settlementContributionDigest(body)
	}
}

function signableBeef(
	inputs: Transaction[],
	outputs: Array<{ lockingScript: string; satoshis: number }>,
	options: { inputOrder?: number[]; change?: number } = {},
): number[] {
	const funding = sourceTransaction(p2pkh(KEY_FUNDING), 100)
	const sources = [...inputs, funding]
	const order = options.inputOrder ?? sources.map((_, index) => index)
	const tx = new Transaction()
	for (const sourceIndex of order) {
		const source = sources[sourceIndex]
		tx.addInput({
			sourceTransaction: source,
			sourceOutputIndex: 0,
			unlockingScript: new UnlockingScript(),
			sequence: 0xffffffff,
		})
	}
	for (const output of outputs) {
		tx.addOutput({
			lockingScript: LockingScript.fromHex(output.lockingScript),
			satoshis: output.satoshis,
		})
	}
	if (options.change !== undefined) {
		tx.addOutput({
			lockingScript: new P2PKH().lock(KEY_FUNDING.toAddress()),
			satoshis: options.change,
		})
	}
	const beef = new Beef()
	for (const source of sources) beef.mergeTransaction(source)
	beef.mergeTransaction(tx)
	return beef.toBinaryAtomic(tx.id('hex'))
}

function mixedFixture() {
	const ordinalScript = Inscription.fromText('vector-a', 'text/plain', {
		scriptSuffix: new P2PKH().lock(KEY_A.toAddress()),
	})
		.lock()
		.toHex()
	const ordinal = sourceTransaction(ordinalScript)
	const token75 = sourceTransaction(
		BSV21.transfer(TOKEN_1, 75n)
			.lock(new P2PKH().lock(KEY_B.toAddress()))
			.toHex(),
	)
	const token40 = sourceTransaction(
		BSV21.transfer(TOKEN_1, 40n)
			.lock(new P2PKH().lock(KEY_B.toAddress()))
			.toHex(),
	)
	const source = sourceBeef([ordinal, token75, token40])
	const inputs = [
		assetInput(ordinal, PARTY_A, 'ordinal', source.hash),
		assetInput(token75, PARTY_B, 'bsv21', source.hash, {
			id: TOKEN_1,
			amount: '75',
		}),
		assetInput(token40, PARTY_B, 'bsv21', source.hash, {
			id: TOKEN_1,
			amount: '40',
		}),
	]
	const ordinalReceipt = p2pkh(KEY_B)
	const tokenReceipt = BSV21.transfer(TOKEN_1, 100n)
		.lock(new P2PKH().lock(KEY_A.toAddress()))
		.toHex()
	const tokenChange = BSV21.transfer(TOKEN_1, 15n)
		.lock(new P2PKH().lock(KEY_B.toAddress()))
		.toHex()
	const destinations = [
		destination({
			legIndex: 0,
			owner: PARTY_B,
			purpose: 'ordinal-receipt',
			lockingScript: ordinalReceipt,
			satoshis: '1',
			sourceOrdinal: inputs[0].outpoint,
		}),
		destination({
			legIndex: 0,
			owner: PARTY_A,
			purpose: 'bsv21-receipt',
			lockingScript: tokenReceipt,
			satoshis: '1',
			tokenId: TOKEN_1,
			tokenAmount: '100',
		}),
		destination({
			legIndex: 0,
			owner: PARTY_B,
			purpose: 'bsv21-change',
			lockingScript: tokenChange,
			satoshis: '1',
			tokenId: TOKEN_1,
			tokenAmount: '15',
		}),
	]
	const offer = lockedOffer([
		{
			owner: PARTY_A,
			revision: 3,
			items: [{ kind: 'ordinal', outpoint: inputs[0].outpoint }],
		},
		{
			owner: PARTY_B,
			revision: 7,
			items: [{ kind: 'bsv21', tokenId: TOKEN_1, amount: '100' }],
		},
	])
	const policy = overlayPolicy(TOKEN_1, '3')
	const plan = planFor(offer, inputs, destinations, [source], [policy])
	const outputs = [
		{ lockingScript: ordinalReceipt, satoshis: 1 },
		{ lockingScript: tokenReceipt, satoshis: 1 },
		{ lockingScript: tokenChange, satoshis: 1 },
		{ lockingScript: policy.feeLockingScript, satoshis: 6 },
	]
	return { ordinal, token75, token40, plan, outputs }
}

describe('settlement canonical commitments', () => {
	test('uses RFC 8785 key ordering and stable SHA-256 commitments', () => {
		expect(canonicalizeSettlementJson({ z: 1, a: ['x', true] })).toBe(
			'{"a":["x",true],"z":1}',
		)
		expect(digestSettlementObject({ z: 1, a: ['x', true] })).toBe(
			digestSettlementObject({ a: ['x', true], z: 1 }),
		)
		expect(canonicalizeSettlementJson({ value: 1.5 })).toBe('{"value":1.5}')
		expect(() => canonicalizeSettlementJson({ value: Number.NaN })).toThrow(
			'finite',
		)
		expect(() => canonicalizeSettlementJson({ value: undefined })).toThrow(
			'unsupported undefined',
		)
		expect(() => canonicalizeSettlementJson(new Date(0))).toThrow('plain JSON')
		expect(() =>
			canonicalizeSettlementJson({ value: Number.MAX_SAFE_INTEGER + 1 }),
		).toThrow('integers must be safe')
		expect(() => canonicalizeSettlementJson(new Array(1))).toThrow(
			'JSON values',
		)
		const cyclic: { self?: unknown } = {}
		cyclic.self = cyclic
		expect(() => canonicalizeSettlementJson(cyclic)).toThrow('cyclic')
		const inherited = Object.create({ required: true }) as Record<
			string,
			unknown
		>
		expect(() => assertExactKeys(inherited, ['required'])).toThrow(
			'missing field',
		)
		const inheritedOptional = Object.create({ optional: true }) as Record<
			string,
			unknown
		>
		expect(() => assertExactKeys(inheritedOptional, [], ['optional'])).toThrow(
			'inherited field',
		)
		expect(() => canonicalizeSettlementJson({ value: '\ud800' })).toThrow(
			'invalid Unicode',
		)
	})

	test('rejects unknown offer fields, wrong ordering, expiry, and noncanonical quantities', () => {
		const fixture = mixedFixture()
		expect(validateLockedOffer(fixture.plan.lockedOffer, NOW)).toBeTruthy()
		expect(() =>
			validateLockedOffer(
				{
					...fixture.plan.lockedOffer,
					surprise: true,
				} as LockedOfferCommitmentV1,
				NOW,
			),
		).toThrow('unknown field')
		expect(() =>
			validateLockedOffer(
				{
					...fixture.plan.lockedOffer,
					parties: [...PARTIES].reverse() as [string, string],
				},
				NOW,
			),
		).toThrow('sorted')
		expect(() =>
			validateLockedOffer({ ...fixture.plan.lockedOffer, expiresAt: NOW }, NOW),
		).toThrow('expired')
		const bad = structuredClone(fixture.plan.lockedOffer)
		bad.offers.find((entry) => entry.owner === PARTY_B)!.items[0] = {
			kind: 'bsv21',
			tokenId: TOKEN_1,
			amount: '0100',
		}
		expect(() => validateLockedOffer(bad, NOW)).toThrow('noncanonical amount')
	})
})

describe('deterministic BSV21 selection and reservation', () => {
	test('selects amount descending then outpoint ascending and returns exact change', () => {
		const candidates = [40n, 75n, 75n].map((amount, index) => ({
			outpoint: `${String.fromCharCode(98 + index).repeat(64)}_${index}`,
			tokenId: TOKEN_1,
			amount: amount.toString(),
			operation: 'transfer' as const,
			active: true,
			unspent: true,
			statusCheckedAt: NOW,
			sourceSatoshis: '1',
			sourceScriptHash: 'a'.repeat(64),
			sourceBeefHash: 'b'.repeat(64),
		}))
		const selected = selectBsv21Tips(TOKEN_1, '100', candidates, {
			now: NOW,
			maxEvidenceAgeMs: MAX_AGE,
		})
		expect(selected.tips.map((tip) => tip.amount)).toEqual(['75', '75'])
		expect(selected.selectedAmount).toBe('150')
		expect(selected.changeAmount).toBe('50')
	})

	test('fails closed on stale, inactive, non-transfer, wrong-token, overflow, and insufficient tips', () => {
		const base = {
			outpoint: `${'a'.repeat(64)}_0`,
			tokenId: TOKEN_1,
			amount: '10',
			operation: 'transfer' as const,
			active: true,
			unspent: true,
			statusCheckedAt: NOW,
			sourceSatoshis: '1',
			sourceScriptHash: 'a'.repeat(64),
			sourceBeefHash: 'b'.repeat(64),
		}
		const run = (candidate: typeof base) =>
			selectBsv21Tips(TOKEN_1, '10', [candidate], {
				now: NOW,
				maxEvidenceAgeMs: MAX_AGE,
			})
		expect(() => run({ ...base, statusCheckedAt: NOW - MAX_AGE - 1 })).toThrow(
			'stale',
		)
		expect(() => run({ ...base, active: false })).toThrow('inactive')
		expect(() =>
			run({ ...base, active: 'false' as unknown as boolean }),
		).toThrow('inactive')
		expect(() => run({ ...base, operation: 'auth' as 'transfer' })).toThrow(
			'forbidden',
		)
		expect(() => run({ ...base, tokenId: TOKEN_2 })).toThrow('wrong token')
		expect(() =>
			run({ ...base, amount: (MAX_BSV21_AMOUNT + 1n).toString() }),
		).toThrow('uint64')
		expect(() => run({ ...base, amount: '9' })).toThrow('insufficient')
		expect(() =>
			selectBsv21Tips(TOKEN_1, '10', [base], {
				now: Number.NaN,
				maxEvidenceAgeMs: MAX_AGE,
			}),
		).toThrow('expected nonnegative safe integer')
	})

	test('binds leases to wallet/provider/attempt and rejects adapter substitution', async () => {
		let changed = false
		const adapter: SettlementReservationAdapter = {
			reserve: async (request) => ({
				reservationId: 'lease',
				request: changed ? { ...request, attempt: 2 } : request,
				expiresAt: EXPIRES,
			}),
			validate: async () => true,
			release: async () => {},
		}
		const request = {
			settlementId: 'settlement',
			attempt: 1,
			offerDigest: 'a'.repeat(64),
			walletIdentity: PARTY_A,
			providerInstanceId: 'provider',
			expiresAt: EXPIRES,
			outpoints: [`${'a'.repeat(64)}_0`],
		}
		expect(
			(await reserveSettlementInputs(adapter, request, NOW)).reservationId,
		).toBe('lease')
		changed = true
		await expect(
			reserveSettlementInputs(adapter, request, NOW),
		).rejects.toThrow('changed request binding')
	})
})

describe('atomic settlement templates', () => {
	test('builder createAction orders ordinal inputs and receipts for a valid sat path', async () => {
		const fixture = mixedFixture()
		let captured: CreateActionArgs | undefined
		const wallet = {
			createAction: async (
				args: CreateActionArgs,
			): Promise<CreateActionResult> => {
				captured = args
				const sources = Beef.fromBinary(Array.from(args.inputBEEF!))
				const funding = sourceTransaction(p2pkh(KEY_FUNDING), 100)
				const tx = new Transaction()
				for (const input of args.inputs ?? []) {
					const [txid, vout] = input.outpoint.split('.')
					tx.addInput({
						sourceTransaction: sources.findTxid(txid)?.tx,
						sourceTXID: txid,
						sourceOutputIndex: Number(vout),
						unlockingScript: new UnlockingScript(),
						sequence: 0xffffffff,
					})
				}
				tx.addInput({
					sourceTransaction: funding,
					sourceOutputIndex: 0,
					unlockingScript: new UnlockingScript(),
					sequence: 0xffffffff,
				})
				for (const output of args.outputs ?? []) {
					tx.addOutput({
						lockingScript: LockingScript.fromHex(output.lockingScript),
						satoshis: output.satoshis,
					})
				}
				tx.addOutput({
					lockingScript: new P2PKH().lock(KEY_FUNDING.toAddress()),
					satoshis: 90,
				})
				const beef = new Beef()
				beef.mergeBeef(sources)
				beef.mergeTransaction(funding)
				beef.mergeTransaction(tx)
				return {
					signableTransaction: {
						reference: 'builder-reference',
						tx: beef.toBinaryAtomic(tx.id('hex')),
					},
				}
			},
			abortAction: async () => ({ aborted: true }),
		} as WalletInterface
		const local = await prepareSettlementAction(wallet, fixture.plan, {
			now: NOW,
			maxEvidenceAgeMs: MAX_AGE,
		})
		expect(captured?.inputs?.[0].outpoint).toBe(
			fixture.plan.lockedOffer.offers.find((offer) => offer.owner === PARTY_A)!
				.items[0].kind === 'ordinal'
				? fixture.plan.lockedOffer.offers
						.find((offer) => offer.owner === PARTY_A)!
						.items[0].outpoint.replace('_', '.')
				: '',
		)
		expect(local.template.manifest.inputs[0].purpose).toBe('ordinal')
		expect(local.template.manifest.outputs[0].purpose).toBe('ordinal-receipt')
	})

	test('Vector A reconstructs ordinal-for-BSV21 with exact change and overlay fee', () => {
		const fixture = mixedFixture()
		expect(
			validateSettlementPlan(fixture.plan, {
				now: NOW,
				maxEvidenceAgeMs: MAX_AGE,
			}),
		).toBeTruthy()
		const beef = signableBeef(
			[fixture.ordinal, fixture.token75, fixture.token40],
			fixture.outputs,
			{ change: 90 },
		)
		const template = reconstructSettlementTemplate(fixture.plan, beef, {
			now: NOW,
			maxEvidenceAgeMs: MAX_AGE,
		})
		expect(
			template.manifest.inputs.filter((input) => input.purpose === 'bsv21'),
		).toHaveLength(2)
		expect(
			template.manifest.outputs.find(
				(output) => output.purpose === 'bsv21-change',
			),
		).toMatchObject({
			tokenAmount: '15',
		})
		expect(
			template.manifest.outputs.find(
				(output) => output.purpose === 'overlay-fee',
			),
		).toMatchObject({
			satoshis: '6',
		})
		expect(
			template.manifest.outputs.find(
				(output) => output.purpose === 'builder-change',
			),
		).toBeTruthy()
	})

	test('fails on token amount/output/fee substitution, missing change, or extra token output', () => {
		const fixture = mixedFixture()
		const build = (outputs: typeof fixture.outputs) =>
			reconstructSettlementTemplate(
				fixture.plan,
				signableBeef(
					[fixture.ordinal, fixture.token75, fixture.token40],
					outputs,
					{
						change: 90,
					},
				),
				{ now: NOW, maxEvidenceAgeMs: MAX_AGE },
			)
		expect(() =>
			build(fixture.outputs.filter((_, index) => index !== 2)),
		).toThrow('missing or substituted')
		expect(() =>
			build(
				fixture.outputs.map((output, index) =>
					index === 3 ? { ...output, satoshis: 3 } : output,
				),
			),
		).toThrow('missing or substituted')
		const wrongAmount = BSV21.transfer(TOKEN_1, 99n)
			.lock(new P2PKH().lock(KEY_A.toAddress()))
			.toHex()
		expect(() =>
			build(
				fixture.outputs.map((output, index) =>
					index === 1 ? { ...output, lockingScript: wrongAmount } : output,
				),
			),
		).toThrow('missing or substituted')
		const extra = BSV21.transfer(TOKEN_1, 1n)
			.lock(new P2PKH().lock(KEY_A.toAddress()))
			.toHex()
		expect(() =>
			build([...fixture.outputs, { lockingScript: extra, satoshis: 1 }]),
		).toThrow('extra asset')
		const wrongTokenSource = sourceTransaction(
			BSV21.transfer(TOKEN_2, 1n)
				.lock(new P2PKH().lock(KEY_B.toAddress()))
				.toHex(),
		)
		const wrongTokenBeef = sourceBeef([wrongTokenSource])
		const badPlan = structuredClone(fixture.plan)
		badPlan.sourceBEEFs.push(wrongTokenBeef)
		badPlan.contributions
			.find((contribution) => contribution.owner === PARTY_B)!
			.inputs.push(
				assetInput(wrongTokenSource, PARTY_B, 'bsv21', wrongTokenBeef.hash, {
					id: TOKEN_2,
					amount: '1',
				}),
			)
		rehashPlanContributions(badPlan)
		expect(() =>
			validateSettlementPlan(badPlan, { now: NOW, maxEvidenceAgeMs: MAX_AGE }),
		).toThrow('unagreed asset input')
		const imbalanced = structuredClone(fixture.plan)
		const change = imbalanced.contributions
			.flatMap((contribution) => contribution.destinations)
			.find((output) => output.purpose === 'bsv21-change')!
		change.tokenAmount = '14'
		change.lockingScript = BSV21.transfer(TOKEN_1, 14n)
			.lock(new P2PKH().lock(KEY_B.toAddress()))
			.toHex()
		rehashPlanContributions(imbalanced)
		expect(() =>
			validateSettlementPlan(imbalanced, {
				now: NOW,
				maxEvidenceAgeMs: MAX_AGE,
			}),
		).toThrow('incorrect BSV21 change')
	})

	test('rejects malformed contribution status types before transaction construction', () => {
		const fixture = mixedFixture()
		const input = fixture.plan.contributions[0].inputs[0]
		Object.assign(input, {
			active: 'false',
			unspent: 'false',
			statusCheckedAt: 'not-a-number',
		})
		rehashPlanContributions(fixture.plan)
		expect(() =>
			validateSettlementPlan(fixture.plan, {
				now: NOW,
				maxEvidenceAgeMs: MAX_AGE,
			}),
		).toThrow('spent or inactive')

		Object.assign(input, {
			active: true,
			unspent: true,
			statusCheckedAt: 'not-a-number',
		})
		rehashPlanContributions(fixture.plan)
		expect(() =>
			validateSettlementPlan(fixture.plan, {
				now: NOW,
				maxEvidenceAgeMs: MAX_AGE,
			}),
		).toThrow('expected nonnegative safe integer')
	})

	test('rejects an invalid validation clock', () => {
		const fixture = mixedFixture()
		expect(() =>
			validateSettlementPlan(fixture.plan, {
				now: Number.NaN,
				maxEvidenceAgeMs: MAX_AGE,
			}),
		).toThrow('expected nonnegative safe integer')
	})

	test('locates reordered inputs by outpoint and rejects reorder that loses the ordinal sat', () => {
		const fixture = mixedFixture()
		const bad = signableBeef(
			[fixture.ordinal, fixture.token75, fixture.token40],
			fixture.outputs,
			{ inputOrder: [1, 2, 3, 0], change: 90 },
		)
		expect(() =>
			reconstructSettlementTemplate(fixture.plan, bad, {
				now: NOW,
				maxEvidenceAgeMs: MAX_AGE,
			}),
		).toThrow('ordinal sat')
	})

	test('builds BRC-100-compatible exact per-owner preimages with only SIGHASH_ALL|FORKID', () => {
		const fixture = mixedFixture()
		const beef = signableBeef(
			[fixture.ordinal, fixture.token75, fixture.token40],
			fixture.outputs,
			{ change: 90 },
		)
		const template = reconstructSettlementTemplate(fixture.plan, beef, {
			now: NOW,
			maxEvidenceAgeMs: MAX_AGE,
		})
		const request = createSettlementSigningRequest(
			fixture.plan,
			template,
			PARTY_B,
			{
				now: NOW,
				maxEvidenceAgeMs: MAX_AGE,
				authorizationExpiresAt: NOW + 30_000,
			},
		)
		expect(request.inputs).toHaveLength(2)
		expect(
			request.inputs.every(
				(input) => input.sighashScope === SETTLEMENT_SIGHASH_SCOPE,
			),
		).toBe(true)
		expect(request.inputs.map((input) => input.inputIndex)).toEqual([1, 2])
		expect(request.inputs.every((input) => input.preimage.length > 100)).toBe(
			true,
		)
		const substituted = structuredClone(template)
		substituted.manifest.outputs[0].satoshis = '2'
		expect(() =>
			createSettlementSigningRequest(fixture.plan, substituted, PARTY_B, {
				now: NOW,
				maxEvidenceAgeMs: MAX_AGE,
				authorizationExpiresAt: NOW + 30_000,
			}),
		).toThrow('template substitution')
	})

	test('signs and locally verifies each owner input before the builder finalizes', async () => {
		const fixture = mixedFixture()
		const beef = signableBeef(
			[fixture.ordinal, fixture.token75, fixture.token40],
			fixture.outputs,
			{ change: 90 },
		)
		const template = reconstructSettlementTemplate(fixture.plan, beef, {
			now: NOW,
			maxEvidenceAgeMs: MAX_AGE,
		})
		const walletFor = (key: PrivateKey): WalletInterface =>
			({
				createSignature: async (args: { hashToDirectlySign?: number[] }) => ({
					signature: Array.from(
						ECDSA.sign(
							new BigNumber(args.hashToDirectlySign!),
							key,
							true,
						).toDER(),
					),
				}),
				getPublicKey: async () => ({
					publicKey: Utils.toHex(key.toPublicKey().encode(true) as number[]),
				}),
			}) as WalletInterface
		const authorize = async (owner: string, key: PrivateKey) => {
			const request = createSettlementSigningRequest(
				fixture.plan,
				template,
				owner,
				{
					now: NOW,
					maxEvidenceAgeMs: MAX_AGE,
					authorizationExpiresAt: NOW + 30_000,
				},
			)
			return authorizeSettlementInputs(
				walletFor(key),
				fixture.plan,
				template,
				request,
				request.inputs.map((input) => ({
					inputIndex: input.inputIndex,
					protocolID: [2, '1sat settlement'],
					keyID: 'fixture',
					template: 'p2pkh',
				})),
				{ now: NOW, maxEvidenceAgeMs: MAX_AGE },
			)
		}
		const authorizations = await Promise.all([
			authorize(PARTY_A, KEY_A),
			authorize(PARTY_B, KEY_B),
		])
		expect(authorizations[0].authorizedInputs).toHaveLength(1)
		expect(authorizations[1].authorizedInputs).toHaveLength(2)
		let finalizedSpends = 0
		const builder = {
			signAction: async (args: { spends?: Record<number, unknown> }) => {
				finalizedSpends = Object.keys(args.spends ?? {}).length
				return { txid: 'f'.repeat(64), tx: beef }
			},
			abortAction: async () => ({ aborted: true }),
		} as WalletInterface
		const localAction = {
			reference: 'builder-local-only',
			createResult: {
				signableTransaction: { reference: 'builder-local-only', tx: beef },
			},
			template,
		}
		const result = await finalizeSettlementAction(
			builder,
			fixture.plan,
			localAction,
			authorizations,
			{ now: NOW, maxEvidenceAgeMs: MAX_AGE },
		)
		expect(result.txid).toBe('f'.repeat(64))
		expect(finalizedSpends).toBe(3)

		const requestWithUnknownField = createSettlementSigningRequest(
			fixture.plan,
			template,
			PARTY_A,
			{
				now: NOW,
				maxEvidenceAgeMs: MAX_AGE,
				authorizationExpiresAt: NOW + 30_000,
			},
		)
		;(
			requestWithUnknownField as unknown as Record<string, unknown>
		).unexpected = true
		await expect(
			authorizeSettlementInputs(
				walletFor(KEY_A),
				fixture.plan,
				template,
				requestWithUnknownField,
				requestWithUnknownField.inputs.map((input) => ({
					inputIndex: input.inputIndex,
					protocolID: [2, '1sat settlement'],
					keyID: 'fixture',
					template: 'p2pkh',
				})),
				{ now: NOW, maxEvidenceAgeMs: MAX_AGE },
			),
		).rejects.toThrow('unknown field')

		const duplicatedAuthorization = structuredClone(authorizations)
		duplicatedAuthorization[0].authorizedInputs.push(
			duplicatedAuthorization[0].authorizedInputs[0],
		)
		await expect(
			finalizeSettlementAction(
				builder,
				fixture.plan,
				localAction,
				duplicatedAuthorization,
				{ now: NOW, maxEvidenceAgeMs: MAX_AGE },
			),
		).rejects.toThrow('authorization input set mismatch')

		await expect(
			finalizeSettlementAction(
				builder,
				fixture.plan,
				{ ...localAction, reference: 'substituted-reference' },
				authorizations,
				{ now: NOW, maxEvidenceAgeMs: MAX_AGE },
			),
		).rejects.toThrow('reference or transaction substitution')

		await expect(
			finalizeSettlementAction(
				builder,
				{
					...fixture.plan,
				},
				{
					...localAction,
					createResult: {
						signableTransaction: {
							reference: localAction.reference,
							tx: [...beef, 0],
						},
					},
				},
				authorizations,
				{ now: NOW, maxEvidenceAgeMs: MAX_AGE },
			),
		).rejects.toThrow('reference or transaction substitution')
	})
})

describe('ordinal-only and BSV21-only modes', () => {
	test('supports an ordinal-only two-party swap', () => {
		const ordinalA = sourceTransaction(
			Inscription.fromText('a', 'text/plain', {
				scriptSuffix: new P2PKH().lock(KEY_A.toAddress()),
			})
				.lock()
				.toHex(),
		)
		const ordinalB = sourceTransaction(
			Inscription.fromText('b', 'text/plain', {
				scriptSuffix: new P2PKH().lock(KEY_B.toAddress()),
			})
				.lock()
				.toHex(),
		)
		const source = sourceBeef([ordinalA, ordinalB])
		const inputs = [
			assetInput(ordinalA, PARTY_A, 'ordinal', source.hash),
			assetInput(ordinalB, PARTY_B, 'ordinal', source.hash),
		]
		const outputs = [
			destination({
				legIndex: 0,
				owner: PARTY_B,
				purpose: 'ordinal-receipt',
				lockingScript: p2pkh(KEY_B),
				satoshis: '1',
				sourceOrdinal: inputs[0].outpoint,
			}),
			destination({
				legIndex: 0,
				owner: PARTY_A,
				purpose: 'ordinal-receipt',
				lockingScript: p2pkh(KEY_A),
				satoshis: '1',
				sourceOrdinal: inputs[1].outpoint,
			}),
		]
		const offer = lockedOffer([
			{
				owner: PARTY_A,
				revision: 1,
				items: [{ kind: 'ordinal', outpoint: inputs[0].outpoint }],
			},
			{
				owner: PARTY_B,
				revision: 1,
				items: [{ kind: 'ordinal', outpoint: inputs[1].outpoint }],
			},
		])
		const plan = planFor(offer, inputs, outputs, [source], [])
		const template = reconstructSettlementTemplate(
			plan,
			signableBeef(
				[ordinalA, ordinalB],
				outputs.map((output) => ({
					lockingScript: output.lockingScript,
					satoshis: 1,
				})),
				{ change: 95 },
			),
			{ now: NOW, maxEvidenceAgeMs: MAX_AGE },
		)
		expect(template.manifest.overlayPolicies).toEqual([])
		expect(
			template.manifest.outputs.filter(
				(output) => output.purpose === 'ordinal-receipt',
			),
		).toHaveLength(2)
	})

	test('Vector B conserves each BSV21 token independently with exact fees', () => {
		const a50 = sourceTransaction(
			BSV21.transfer(TOKEN_1, 50n)
				.lock(new P2PKH().lock(KEY_A.toAddress()))
				.toHex(),
		)
		const b7 = sourceTransaction(
			BSV21.transfer(TOKEN_2, 7n)
				.lock(new P2PKH().lock(KEY_B.toAddress()))
				.toHex(),
		)
		const b5 = sourceTransaction(
			BSV21.transfer(TOKEN_2, 5n)
				.lock(new P2PKH().lock(KEY_B.toAddress()))
				.toHex(),
		)
		const source = sourceBeef([a50, b7, b5])
		const inputs = [
			assetInput(a50, PARTY_A, 'bsv21', source.hash, {
				id: TOKEN_1,
				amount: '50',
			}),
			assetInput(b7, PARTY_B, 'bsv21', source.hash, {
				id: TOKEN_2,
				amount: '7',
			}),
			assetInput(b5, PARTY_B, 'bsv21', source.hash, {
				id: TOKEN_2,
				amount: '5',
			}),
		]
		const tokenOutput = (
			owner: string,
			purpose: 'bsv21-receipt' | 'bsv21-change',
			id: string,
			amount: string,
			key: PrivateKey,
		) =>
			destination({
				legIndex: 0,
				owner,
				purpose,
				lockingScript: BSV21.transfer(id, BigInt(amount))
					.lock(new P2PKH().lock(key.toAddress()))
					.toHex(),
				satoshis: '1',
				tokenId: id,
				tokenAmount: amount,
			})
		const destinations = [
			tokenOutput(PARTY_B, 'bsv21-receipt', TOKEN_1, '30', KEY_B),
			tokenOutput(PARTY_A, 'bsv21-change', TOKEN_1, '20', KEY_A),
			tokenOutput(PARTY_A, 'bsv21-receipt', TOKEN_2, '9', KEY_A),
			tokenOutput(PARTY_B, 'bsv21-change', TOKEN_2, '3', KEY_B),
		]
		const offer = lockedOffer([
			{
				owner: PARTY_A,
				revision: 2,
				items: [{ kind: 'bsv21', tokenId: TOKEN_1, amount: '30' }],
			},
			{
				owner: PARTY_B,
				revision: 2,
				items: [{ kind: 'bsv21', tokenId: TOKEN_2, amount: '9' }],
			},
		])
		const policies = [overlayPolicy(TOKEN_1, '2'), overlayPolicy(TOKEN_2, '5')]
		const plan = planFor(offer, inputs, destinations, [source], policies)
		const expectedOutputs = [
			...destinations.map((output) => ({
				lockingScript: output.lockingScript,
				satoshis: 1,
			})),
			{ lockingScript: policies[0].feeLockingScript, satoshis: 4 },
			{ lockingScript: policies[1].feeLockingScript, satoshis: 10 },
		]
		const template = reconstructSettlementTemplate(
			plan,
			signableBeef([a50, b7, b5], expectedOutputs, { change: 80 }),
			{ now: NOW, maxEvidenceAgeMs: MAX_AGE },
		)
		expect(
			template.manifest.overlayPolicies.map((policy) => policy.totalFee),
		).toEqual(['4', '10'])
		expect(
			template.manifest.outputs
				.filter((output) => output.purpose.startsWith('bsv21'))
				.map((output) => `${output.tokenId}:${output.tokenAmount}`),
		).toEqual([
			`${TOKEN_1}:30`,
			`${TOKEN_1}:20`,
			`${TOKEN_2}:9`,
			`${TOKEN_2}:3`,
		])
	})
})

describe('replay guard', () => {
	test('is idempotent for exact bytes and rejects changed bytes under the same binding', async () => {
		const store = new InMemorySettlementReplayStore()
		expect(
			await recordSettlementArtifact(
				store,
				'attempt:1',
				{ hash: 'a' },
				EXPIRES,
				NOW,
			),
		).toBe(true)
		expect(
			await recordSettlementArtifact(
				store,
				'attempt:1',
				{ hash: 'a' },
				EXPIRES,
				NOW,
			),
		).toBe(false)
		await expect(
			recordSettlementArtifact(store, 'attempt:1', { hash: 'b' }, EXPIRES, NOW),
		).rejects.toThrow('different artifact')
	})

	test('atomically rejects concurrent conflicting artifacts', async () => {
		const store = new InMemorySettlementReplayStore()
		const results = await Promise.allSettled([
			recordSettlementArtifact(store, 'attempt:1', { hash: 'a' }, EXPIRES, NOW),
			recordSettlementArtifact(store, 'attempt:1', { hash: 'b' }, EXPIRES, NOW),
		])
		expect(
			results.filter((result) => result.status === 'fulfilled'),
		).toHaveLength(1)
		expect(
			results.filter((result) => result.status === 'rejected'),
		).toHaveLength(1)
	})

	test('keeps identical concurrent artifacts idempotent and replaces expired records', async () => {
		const store = new InMemorySettlementReplayStore()
		expect(
			await Promise.all([
				recordSettlementArtifact(
					store,
					'attempt:1',
					{ hash: 'a' },
					EXPIRES,
					NOW,
				),
				recordSettlementArtifact(
					store,
					'attempt:1',
					{ hash: 'a' },
					EXPIRES,
					NOW,
				),
			]),
		).toEqual([true, false])
		expect(
			await recordSettlementArtifact(
				store,
				'attempt:1',
				{ hash: 'b' },
				EXPIRES + 1,
				EXPIRES,
			),
		).toBe(true)
	})

	test('rejects an invalid replay clock before consulting the store', async () => {
		const store = new InMemorySettlementReplayStore()
		await expect(
			recordSettlementArtifact(
				store,
				'attempt:1',
				{ hash: 'a' },
				EXPIRES,
				Number.NaN,
			),
		).rejects.toThrow('expected nonnegative safe integer')
	})
})
