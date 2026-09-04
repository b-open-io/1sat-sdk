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
	MAX_BSV21_AMOUNT,
	MAX_SETTLEMENT_ASSET_INPUTS,
	type OverlayPolicyV1,
	type SettlementAssetInputV1,
	type SettlementContributionV1,
	type SettlementDestinationV1,
	type SettlementOfferV1,
	type SettlementPlanV1,
	authorizeSettlementInputs,
	finalizeSettlementAction,
	hashSettlementBytes,
	prepareSettlementAction,
	reconstructSettlementTemplate,
	selectBsv21Tips,
	validateSettlementPlan,
} from '../src/settlement'

const NOW = 1_800_000_000_000
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

function destination(values: SettlementDestinationV1): SettlementDestinationV1 {
	return values
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

function planFor(
	offers: SettlementOfferV1[],
	inputs: SettlementAssetInputV1[],
	destinations: SettlementDestinationV1[],
	sources: Array<{ hash: string; beef: number[] }>,
	policies: OverlayPolicyV1[],
): SettlementPlanV1 {
	const contributions = PARTIES.map((owner) => {
		return {
			owner,
			inputs: inputs.filter((input) => input.owner === owner),
			destinations: destinations.filter((output) => output.owner === owner),
		}
	}) as [SettlementContributionV1, SettlementContributionV1]
	return {
		chain: 'main',
		parties: PARTIES,
		offers: [...offers].sort((a, b) => a.owner.localeCompare(b.owner)) as [
			SettlementOfferV1,
			SettlementOfferV1,
		],
		builder: PARTY_A,
		contributions,
		overlayPolicies: policies,
		sourceBEEFs: sources,
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

function signingWallet(key: PrivateKey): WalletInterface {
	return {
		createSignature: async (args: { hashToDirectlySign?: number[] }) => ({
			signature: Array.from(
				ECDSA.sign(new BigNumber(args.hashToDirectlySign!), key, true).toDER(),
			),
		}),
		getPublicKey: async () => ({
			publicKey: Utils.toHex(key.toPublicKey().encode(true) as number[]),
		}),
	} as WalletInterface
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
	const offers: SettlementOfferV1[] = [
		{
			owner: PARTY_A,
			items: [{ kind: 'ordinal', outpoint: inputs[0].outpoint }],
		},
		{
			owner: PARTY_B,
			items: [{ kind: 'bsv21', tokenId: TOKEN_1, amount: '100' }],
		},
	]
	const policy = overlayPolicy(TOKEN_1, '3')
	const plan = planFor(offers, inputs, destinations, [source], [policy])
	const outputs = [
		{ lockingScript: ordinalReceipt, satoshis: 1 },
		{ lockingScript: tokenReceipt, satoshis: 1 },
		{ lockingScript: tokenChange, satoshis: 1 },
		{ lockingScript: policy.feeLockingScript, satoshis: 6 },
	]
	return { ordinal, token75, token40, plan, outputs }
}

function oversizedOutputFixture(): SettlementPlanV1 {
	const sourceTransactions: Transaction[] = []
	const inputs: SettlementAssetInputV1[] = []
	const destinations: SettlementDestinationV1[] = []
	const policies: OverlayPolicyV1[] = []
	const items = new Map<string, SettlementOfferV1['items']>([
		[PARTY_A, []],
		[PARTY_B, []],
	])
	for (let index = 0; index < MAX_SETTLEMENT_ASSET_INPUTS; index += 1) {
		const tokenId = `${(index + 1).toString(16).padStart(64, '0')}_0`
		const owner = index === MAX_SETTLEMENT_ASSET_INPUTS - 1 ? PARTY_B : PARTY_A
		const recipient = owner === PARTY_A ? PARTY_B : PARTY_A
		const ownerKey = owner === PARTY_A ? KEY_A : KEY_B
		const recipientKey = recipient === PARTY_A ? KEY_A : KEY_B
		const legIndex = owner === PARTY_A ? index : 0
		const source = sourceTransaction(
			BSV21.transfer(tokenId, 2n)
				.lock(new P2PKH().lock(ownerKey.toAddress()))
				.toHex(),
		)
		sourceTransactions.push(source)
		inputs.push(
			assetInput(source, owner, 'bsv21', '', {
				id: tokenId,
				amount: '2',
			}),
		)
		items.get(owner)!.push({ kind: 'bsv21', tokenId, amount: '1' })
		destinations.push(
			destination({
				legIndex,
				owner: recipient,
				purpose: 'bsv21-receipt',
				lockingScript: BSV21.transfer(tokenId, 1n)
					.lock(new P2PKH().lock(recipientKey.toAddress()))
					.toHex(),
				satoshis: '1',
				tokenId,
				tokenAmount: '1',
			}),
			destination({
				legIndex,
				owner,
				purpose: 'bsv21-change',
				lockingScript: BSV21.transfer(tokenId, 1n)
					.lock(new P2PKH().lock(ownerKey.toAddress()))
					.toHex(),
				satoshis: '1',
				tokenId,
				tokenAmount: '1',
			}),
		)
		policies.push(overlayPolicy(tokenId, '1'))
	}
	const source = sourceBeef(sourceTransactions)
	for (const input of inputs) input.sourceBeefHash = source.hash
	return planFor(
		[...items.entries()].map(([owner, ownerItems]) => ({
			owner,
			items: ownerItems,
		})),
		inputs,
		destinations,
		[source],
		policies,
	)
}

describe('settlement terms', () => {
	test('rejects unknown fields, wrong ordering, and noncanonical quantities', () => {
		const fixture = mixedFixture()
		expect(
			validateSettlementPlan(fixture.plan, {
				now: NOW,
				maxEvidenceAgeMs: MAX_AGE,
			}),
		).toBeTruthy()
		expect(() =>
			validateSettlementPlan(
				{
					...fixture.plan,
					surprise: true,
				} as SettlementPlanV1,
				{ now: NOW, maxEvidenceAgeMs: MAX_AGE },
			),
		).toThrow('unknown field')
		expect(() =>
			validateSettlementPlan(
				{
					...fixture.plan,
					parties: [...PARTIES].reverse() as [string, string],
				},
				{ now: NOW, maxEvidenceAgeMs: MAX_AGE },
			),
		).toThrow('sorted')
		const bad = structuredClone(fixture.plan)
		bad.offers.find((entry) => entry.owner === PARTY_B)!.items[0] = {
			kind: 'bsv21',
			tokenId: TOKEN_1,
			amount: '0100',
		}
		expect(() =>
			validateSettlementPlan(bad, {
				now: NOW,
				maxEvidenceAgeMs: MAX_AGE,
			}),
		).toThrow('noncanonical amount')
		const oversized = structuredClone(fixture.plan)
		oversized.offers[0].items = Array.from(
			{ length: MAX_SETTLEMENT_ASSET_INPUTS + 1 },
			() => ({ kind: 'ordinal' as const, outpoint: `${'a'.repeat(64)}_0` }),
		)
		expect(() =>
			validateSettlementPlan(oversized, {
				now: NOW,
				maxEvidenceAgeMs: MAX_AGE,
			}),
		).toThrow('too many asset items')
	})

	test('requires exactly one satoshi for ordinal source and receipt', () => {
		const sourceBad = structuredClone(mixedFixture().plan)
		const sourceInput = sourceBad.contributions
			.flatMap((contribution) => contribution.inputs)
			.find((input) => input.purpose === 'ordinal')!
		sourceInput.sourceSatoshis = '2'
		expect(() =>
			validateSettlementPlan(sourceBad, {
				now: NOW,
				maxEvidenceAgeMs: MAX_AGE,
			}),
		).toThrow('ordinal input must contain one satoshi')

		const receiptBad = structuredClone(mixedFixture().plan)
		const receipt = receiptBad.contributions
			.flatMap((contribution) => contribution.destinations)
			.find((destination) => destination.purpose === 'ordinal-receipt')!
		receipt.satoshis = '2'
		expect(() =>
			validateSettlementPlan(receiptBad, {
				now: NOW,
				maxEvidenceAgeMs: MAX_AGE,
			}),
		).toThrow('ordinal receipt must contain one satoshi')
	})

	test('rejects non-finite freshness configuration', () => {
		expect(() =>
			validateSettlementPlan(mixedFixture().plan, {
				now: NOW,
				maxEvidenceAgeMs: Number.NaN,
			}),
		).toThrow('invalid evidence age')
	})

	test('rejects expected outputs above the transaction bound before wallet allocation', async () => {
		let createActionCalled = false
		const wallet = {
			createAction: async () => {
				createActionCalled = true
				throw new Error('wallet should not be called')
			},
		} as unknown as WalletInterface
		await expect(
			prepareSettlementAction(wallet, oversizedOutputFixture(), {
				now: NOW,
				maxEvidenceAgeMs: MAX_AGE,
			}),
		).rejects.toThrow('expected outputs exceed entry limit')
		expect(createActionCalled).toBe(false)
	})
})

describe('deterministic BSV21 selection', () => {
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
		expect(() =>
			selectBsv21Tips(
				TOKEN_1,
				'10',
				Array.from({ length: MAX_SETTLEMENT_ASSET_INPUTS + 1 }, () => base),
				{ now: NOW, maxEvidenceAgeMs: MAX_AGE },
			),
		).toThrow('too many candidates')
		expect(() => run({ ...base, amount: '1'.repeat(21) })).toThrow(
			'noncanonical amount',
		)
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
			fixture.plan.offers.find((offer) => offer.owner === PARTY_A)!.items[0]
				.kind === 'ordinal'
				? fixture.plan.offers
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
		const authorize = async (
			owner: string,
			key: PrivateKey,
			templateToAuthorize = template,
		) => {
			return authorizeSettlementInputs(
				signingWallet(key),
				fixture.plan,
				templateToAuthorize,
				owner,
				template.manifest.inputs
					.filter((input) => input.owner === owner)
					.map((input) => ({
						inputIndex: input.index,
						protocolID: [2, '1sat settlement'],
						keyID: 'fixture',
					})),
				{
					now: NOW,
					maxEvidenceAgeMs: MAX_AGE,
				},
			)
		}
		const authorizations = await Promise.all([
			authorize(PARTY_A, KEY_A),
			authorize(PARTY_B, KEY_B),
		])
		expect(Object.keys(authorizations[0].spends)).toHaveLength(1)
		expect(Object.keys(authorizations[1].spends)).toHaveLength(2)
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

		const substitutedTemplate = structuredClone(template)
		substitutedTemplate.manifest.outputs[0].satoshis = '2'
		await expect(
			authorize(PARTY_A, KEY_A, substitutedTemplate),
		).rejects.toThrow('template substitution')

		const duplicatedAuthorization = structuredClone(authorizations)
		duplicatedAuthorization[0].spends[999] = {
			unlockingScript: Object.values(duplicatedAuthorization[0].spends)[0]
				.unlockingScript,
		}
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

	test('finalizes a BSV-for-ordinal trade with only the asset owner authorization', async () => {
		const ordinal = sourceTransaction(
			Inscription.fromText('for-sale', 'text/plain', {
				scriptSuffix: new P2PKH().lock(KEY_B.toAddress()),
			})
				.lock()
				.toHex(),
		)
		const source = sourceBeef([ordinal])
		const input = assetInput(ordinal, PARTY_B, 'ordinal', source.hash)
		const ordinalReceipt = p2pkh(KEY_A)
		const bsvPayment = p2pkh(KEY_B)
		const plan = planFor(
			[
				{ owner: PARTY_A, items: [{ kind: 'bsv', satoshis: '50' }] },
				{
					owner: PARTY_B,
					items: [{ kind: 'ordinal', outpoint: input.outpoint }],
				},
			],
			[input],
			[
				destination({
					legIndex: 0,
					owner: PARTY_A,
					purpose: 'ordinal-receipt',
					lockingScript: ordinalReceipt,
					satoshis: '1',
					sourceOrdinal: input.outpoint,
				}),
				destination({
					legIndex: 0,
					owner: PARTY_B,
					purpose: 'bsv-payment',
					lockingScript: bsvPayment,
					satoshis: '50',
				}),
			],
			[source],
			[],
		)
		const beef = signableBeef(
			[ordinal],
			[
				{ lockingScript: ordinalReceipt, satoshis: 1 },
				{ lockingScript: bsvPayment, satoshis: 50 },
			],
			{ change: 40 },
		)
		const template = reconstructSettlementTemplate(plan, beef, {
			now: NOW,
			maxEvidenceAgeMs: MAX_AGE,
		})
		const ordinalInput = template.manifest.inputs.find(
			(entry) => entry.owner === PARTY_B,
		)!
		const authorization = await authorizeSettlementInputs(
			signingWallet(KEY_B),
			plan,
			template,
			PARTY_B,
			[
				{
					inputIndex: ordinalInput.index,
					protocolID: [2, '1sat settlement'],
					keyID: 'fixture',
				},
			],
			{ now: NOW, maxEvidenceAgeMs: MAX_AGE },
		)
		let finalizedSpends = 0
		const builder = {
			signAction: async (args: { spends?: Record<number, unknown> }) => {
				finalizedSpends = Object.keys(args.spends ?? {}).length
				return { txid: 'e'.repeat(64), tx: beef }
			},
			abortAction: async () => ({ aborted: true }),
		} as WalletInterface
		const localAction = {
			reference: 'bsv-builder-local-only',
			createResult: {
				signableTransaction: { reference: 'bsv-builder-local-only', tx: beef },
			},
			template,
		}

		const result = await finalizeSettlementAction(
			builder,
			plan,
			localAction,
			[authorization],
			{ now: NOW, maxEvidenceAgeMs: MAX_AGE },
		)
		expect(result.txid).toBe('e'.repeat(64))
		expect(finalizedSpends).toBe(1)
		await expect(
			finalizeSettlementAction(builder, plan, localAction, [], {
				now: NOW,
				maxEvidenceAgeMs: MAX_AGE,
			}),
		).rejects.toThrow('every asset owner authorization required')
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
		const offers: SettlementOfferV1[] = [
			{
				owner: PARTY_A,
				items: [{ kind: 'ordinal', outpoint: inputs[0].outpoint }],
			},
			{
				owner: PARTY_B,
				items: [{ kind: 'ordinal', outpoint: inputs[1].outpoint }],
			},
		]
		const plan = planFor(offers, inputs, outputs, [source], [])
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
		const offers: SettlementOfferV1[] = [
			{
				owner: PARTY_A,
				items: [{ kind: 'bsv21', tokenId: TOKEN_1, amount: '30' }],
			},
			{
				owner: PARTY_B,
				items: [{ kind: 'bsv21', tokenId: TOKEN_2, amount: '9' }],
			},
		]
		const policies = [overlayPolicy(TOKEN_1, '2'), overlayPolicy(TOKEN_2, '5')]
		const plan = planFor(offers, inputs, destinations, [source], policies)
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
