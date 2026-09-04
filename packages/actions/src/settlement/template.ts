import { BSV21, Inscription } from '@1sat/templates'
import {
	Beef,
	type CreateActionInput,
	type CreateActionOutput,
	Hash,
	P2PKH,
	Script,
	Transaction,
	Utils,
	type WalletInterface,
} from '@bsv/sdk'
import { hashSettlementBytes } from './canonical.js'
import type {
	BuilderLocalSettlementActionV1,
	ManifestOutputPurpose,
	OverlayPolicyV1,
	SettlementAssetInputV1,
	SettlementDestinationV1,
	SettlementPlanV1,
	SettlementTemplateV1,
	TemplateManifestInputV1,
	TemplateManifestOutputV1,
	TemplateManifestV1,
	TemplateOverlayPolicyV1,
} from './types.js'
import { MAX_SETTLEMENT_BEEF_BYTES, MAX_SETTLEMENT_OUTPUTS } from './types.js'
import {
	assertHex64,
	assertSettlementOutpoint,
	parseSettlementAmount,
	validateSettlementPlan,
} from './validate.js'

function outpointOfInput(tx: Transaction, inputIndex: number): string {
	const input = tx.inputs[inputIndex]
	const txid = input.sourceTXID ?? input.sourceTransaction?.id('hex')
	if (!txid)
		throw new Error(
			`settlement-template: input ${inputIndex} missing source txid`,
		)
	return `${txid}_${input.sourceOutputIndex}`
}

function scriptHash(script: Script): string {
	return Utils.toHex(Hash.sha256(script.toBinary()))
}

function omitUndefined<T extends Record<string, unknown>>(value: T): T {
	return Object.fromEntries(
		Object.entries(value).filter(([, child]) => child !== undefined),
	) as T
}

function decodeSourceBeefs(plan: SettlementPlanV1): {
	merged: Beef
	byHash: Map<string, Beef>
} {
	if (plan.sourceBEEFs.length === 0) {
		throw new Error('settlement-template: source BEEF is required')
	}
	const merged = new Beef()
	const byHash = new Map<string, Beef>()
	const seen = new Set<string>()
	for (const [index, source] of plan.sourceBEEFs.entries()) {
		assertHex64(source.hash, `sourceBEEFs[${index}].hash`)
		if (hashSettlementBytes(source.beef) !== source.hash) {
			throw new Error('settlement-template: source BEEF hash mismatch')
		}
		if (seen.has(source.hash))
			throw new Error('settlement-template: duplicate source BEEF')
		seen.add(source.hash)
		const decoded = Beef.fromBinary(source.beef)
		byHash.set(source.hash, decoded)
		merged.mergeBeef(decoded)
	}
	return { merged, byHash }
}

function allAssetInputs(plan: SettlementPlanV1): SettlementAssetInputV1[] {
	return plan.contributions.flatMap((contribution) => contribution.inputs)
}

function orderedAssetInputs(plan: SettlementPlanV1): SettlementAssetInputV1[] {
	const inputs = allAssetInputs(plan)
	const ordinals: SettlementAssetInputV1[] = []
	const tokens: SettlementAssetInputV1[] = []
	for (const ownerOffer of plan.offers) {
		for (const item of ownerOffer.items) {
			if (item.kind === 'ordinal') {
				ordinals.push(
					inputs.find(
						(input) =>
							input.owner === ownerOffer.owner &&
							input.purpose === 'ordinal' &&
							input.outpoint === item.outpoint,
					)!,
				)
			} else if (item.kind === 'bsv21') {
				tokens.push(
					...inputs
						.filter(
							(input) =>
								input.owner === ownerOffer.owner &&
								input.purpose === 'bsv21' &&
								input.tokenId === item.tokenId,
						)
						.sort((a, b) => {
							const amountA = BigInt(a.tokenAmount!)
							const amountB = BigInt(b.tokenAmount!)
							if (amountA !== amountB) return amountA > amountB ? -1 : 1
							return a.outpoint.localeCompare(b.outpoint)
						}),
				)
			}
		}
	}
	return [...ordinals, ...tokens]
}

function allDestinations(plan: SettlementPlanV1): SettlementDestinationV1[] {
	return plan.contributions.flatMap((contribution) => contribution.destinations)
}

function orderedDestinations(
	plan: SettlementPlanV1,
): SettlementDestinationV1[] {
	const destinations = allDestinations(plan)
	const ordered: SettlementDestinationV1[] = []
	for (const input of orderedAssetInputs(plan).filter(
		(entry) => entry.purpose === 'ordinal',
	)) {
		ordered.push(
			destinations.find(
				(destination) =>
					destination.purpose === 'ordinal-receipt' &&
					destination.sourceOrdinal === input.outpoint,
			)!,
		)
	}
	for (const ownerOffer of plan.offers) {
		for (const [legIndex, item] of ownerOffer.items.entries()) {
			if (item.kind === 'ordinal') continue
			const recipient = plan.parties.find(
				(party) => party !== ownerOffer.owner,
			)!
			ordered.push(
				destinations.find(
					(destination) =>
						destination.legIndex === legIndex &&
						destination.owner === recipient &&
						destination.purpose ===
							(item.kind === 'bsv21' ? 'bsv21-receipt' : 'bsv-payment'),
				)!,
			)
			if (item.kind === 'bsv21') {
				const change = destinations.find(
					(destination) =>
						destination.legIndex === legIndex &&
						destination.owner === ownerOffer.owner &&
						destination.purpose === 'bsv21-change',
				)
				if (change) ordered.push(change)
			}
		}
	}
	return ordered
}

function validateSource(
	sourceBeefs: Map<string, Beef>,
	input: SettlementAssetInputV1,
): void {
	const beef = sourceBeefs.get(input.sourceBeefHash)
	if (!beef) {
		throw new Error('settlement-template: input references unknown source BEEF')
	}
	const [txid, voutText] = input.outpoint.split('_')
	const source = beef.findTxid(txid)?.tx
	if (!source)
		throw new Error(
			`settlement-template: source tx missing for ${input.outpoint}`,
		)
	const output = source.outputs[Number(voutText)]
	if (!output)
		throw new Error(
			`settlement-template: source output missing for ${input.outpoint}`,
		)
	if ((output.satoshis ?? 0).toString() !== input.sourceSatoshis) {
		throw new Error('settlement-template: source satoshis mismatch')
	}
	if (scriptHash(output.lockingScript) !== input.sourceScriptHash) {
		throw new Error('settlement-template: source script mismatch')
	}
	const token = BSV21.decode(output.lockingScript)
	if (input.purpose === 'bsv21') {
		if (
			!token ||
			token.tokenData.op !== 'transfer' ||
			token.tokenData.id !== input.tokenId ||
			token.tokenData.amt !== input.tokenAmount
		) {
			throw new Error(
				'settlement-template: BSV21 source token/script/amount mismatch',
			)
		}
	} else if (token) {
		throw new Error('settlement-template: ordinal source is a BSV21 token')
	}
}

function validateDestinationScript(destination: SettlementDestinationV1): void {
	const script = Script.fromHex(destination.lockingScript)
	const token = BSV21.decode(script)
	if (
		destination.purpose === 'bsv21-receipt' ||
		destination.purpose === 'bsv21-change'
	) {
		if (
			!token ||
			token.tokenData.op !== 'transfer' ||
			token.tokenData.id !== destination.tokenId ||
			token.tokenData.amt !== destination.tokenAmount
		) {
			throw new Error(
				'settlement-template: BSV21 destination token/script/amount mismatch',
			)
		}
	} else if (token) {
		throw new Error('settlement-template: non-token destination contains BSV21')
	}
}

function validateOverlayPolicy(
	policy: OverlayPolicyV1,
	now: number,
	maxEvidenceAgeMs: number,
): void {
	assertSettlementOutpoint(policy.tokenId, 'overlayPolicy.tokenId')
	if (
		!Number.isSafeInteger(policy.statusCheckedAt) ||
		policy.statusCheckedAt > now ||
		now - policy.statusCheckedAt > maxEvidenceAgeMs
	) {
		throw new Error('settlement-template: stale overlay fee policy')
	}
	parseSettlementAmount(policy.feePerOutput, 'overlayPolicy.feePerOutput', {
		allowZero: true,
	})
	if (
		!policy.feeAddress ||
		!/^(?:[0-9a-f]{2})+$/.test(policy.feeLockingScript)
	) {
		throw new Error('settlement-template: incomplete overlay fee policy')
	}
	let expectedScript: string
	try {
		expectedScript = new P2PKH().lock(policy.feeAddress).toHex()
	} catch {
		throw new Error('settlement-template: invalid overlay fee address')
	}
	if (expectedScript !== policy.feeLockingScript) {
		throw new Error('settlement-template: overlay fee address/script mismatch')
	}
}

function expectedOutputs(
	plan: SettlementPlanV1,
	now: number,
	maxEvidenceAgeMs: number,
): Array<{
	purpose: Exclude<ManifestOutputPurpose, 'builder-change'>
	owner: string | 'overlay-fee'
	satoshis: string
	lockingScript: string
	tokenId?: string
	tokenAmount?: string
	sourceOrdinal?: string
}> {
	const destinations = orderedDestinations(plan)
	for (const destination of destinations) validateDestinationScript(destination)
	const outputs: ReturnType<typeof expectedOutputs> = destinations.map(
		(destination) => ({
			purpose: destination.purpose,
			owner: destination.owner,
			satoshis: destination.satoshis,
			lockingScript: destination.lockingScript,
			tokenId: destination.tokenId,
			tokenAmount: destination.tokenAmount,
			sourceOrdinal: destination.sourceOrdinal,
		}),
	)
	const tokenOutputCounts = new Map<string, number>()
	for (const destination of destinations) {
		if (destination.purpose.startsWith('bsv21')) {
			tokenOutputCounts.set(
				destination.tokenId!,
				(tokenOutputCounts.get(destination.tokenId!) ?? 0) + 1,
			)
		}
	}
	const sortedPolicies = [...plan.overlayPolicies].sort((a, b) =>
		a.tokenId.localeCompare(b.tokenId),
	)
	if (
		new Set(sortedPolicies.map((policy) => policy.tokenId)).size !==
		sortedPolicies.length
	) {
		throw new Error('settlement-template: duplicate overlay policy')
	}
	if (sortedPolicies.length !== tokenOutputCounts.size) {
		throw new Error('settlement-template: missing or extra overlay policy')
	}
	for (const policy of sortedPolicies) {
		validateOverlayPolicy(policy, now, maxEvidenceAgeMs)
		const count = tokenOutputCounts.get(policy.tokenId)
		if (!count)
			throw new Error('settlement-template: overlay policy for unused token')
		const feePerOutput = BigInt(policy.feePerOutput)
		const total = feePerOutput * BigInt(count)
		if (total > BigInt(Number.MAX_SAFE_INTEGER)) {
			throw new Error('settlement-template: overlay fee overflow')
		}
		if (total > 0n) {
			outputs.push({
				purpose: 'overlay-fee',
				owner: 'overlay-fee',
				satoshis: total.toString(),
				lockingScript: policy.feeLockingScript,
				tokenId: policy.tokenId,
			})
		}
	}
	if (outputs.length > MAX_SETTLEMENT_OUTPUTS) {
		throw new Error('settlement-template: expected outputs exceed entry limit')
	}
	return outputs
}

function matchExpectedOutputs(
	tx: Transaction,
	expected: ReturnType<typeof expectedOutputs>,
): TemplateManifestOutputV1[] {
	const unmatched = new Set(tx.outputs.map((_, index) => index))
	const manifest: TemplateManifestOutputV1[] = []
	for (const output of expected) {
		const index = [...unmatched].find((candidate) => {
			const txOutput = tx.outputs[candidate]
			return (
				txOutput.satoshis?.toString() === output.satoshis &&
				txOutput.lockingScript.toHex() === output.lockingScript
			)
		})
		if (index === undefined) {
			throw new Error(
				`settlement-template: missing or substituted ${output.purpose} output`,
			)
		}
		unmatched.delete(index)
		manifest.push(
			omitUndefined({
				index,
				owner: output.owner,
				purpose: output.purpose,
				satoshis: output.satoshis,
				scriptHash: scriptHash(tx.outputs[index].lockingScript),
				tokenId: output.tokenId,
				tokenAmount: output.tokenAmount,
				sourceOrdinal: output.sourceOrdinal,
			}),
		)
	}
	for (const index of unmatched) {
		const output = tx.outputs[index]
		if (
			BSV21.decode(output.lockingScript) ||
			Inscription.decode(output.lockingScript)
		) {
			throw new Error('settlement-template: extra asset or data output')
		}
		if ((output.satoshis ?? 0) <= 0) {
			throw new Error('settlement-template: zero-satoshi builder change')
		}
		manifest.push({
			index,
			owner: 'builder-change',
			purpose: 'builder-change',
			satoshis: (output.satoshis ?? 0).toString(),
			scriptHash: scriptHash(output.lockingScript),
		})
	}
	return manifest.sort((a, b) => a.index - b.index)
}

function traceOrdinals(
	manifestInputs: TemplateManifestInputV1[],
	manifestOutputs: TemplateManifestOutputV1[],
): void {
	let inputStart = 0n
	const inputStarts = new Map<number, bigint>()
	for (const input of manifestInputs) {
		inputStarts.set(input.index, inputStart)
		inputStart += BigInt(input.sourceSatoshis)
	}
	let outputStart = 0n
	const outputRanges = manifestOutputs.map((output) => {
		const start = outputStart
		outputStart += BigInt(output.satoshis)
		return { output, start, end: outputStart }
	})
	for (const input of manifestInputs.filter(
		(entry) => entry.purpose === 'ordinal',
	)) {
		const sat = inputStarts.get(input.index)!
		const containing = outputRanges.find(
			(range) => sat >= range.start && sat < range.end,
		)
		if (
			!containing ||
			containing.output.purpose !== 'ordinal-receipt' ||
			containing.output.sourceOrdinal !== input.outpoint
		) {
			throw new Error(
				'settlement-template: ordinal sat does not land in its receipt',
			)
		}
	}
}

function reconstructManifest(
	plan: SettlementPlanV1,
	tx: Transaction,
	expected: ReturnType<typeof expectedOutputs>,
): TemplateManifestV1 {
	const assets = new Map(
		allAssetInputs(plan).map((input) => [input.outpoint, input]),
	)
	const manifestInputs: TemplateManifestInputV1[] = tx.inputs.map(
		(_, index) => {
			const outpoint = outpointOfInput(tx, index)
			const sourceOutput =
				tx.inputs[index].sourceTransaction?.outputs[
					tx.inputs[index].sourceOutputIndex
				]
			if (!sourceOutput) {
				throw new Error(
					`settlement-template: source transaction missing for input ${index}`,
				)
			}
			const asset = assets.get(outpoint)
			if (!asset) {
				if (
					BSV21.decode(sourceOutput.lockingScript) ||
					Inscription.decode(sourceOutput.lockingScript)
				) {
					throw new Error('settlement-template: unagreed asset input')
				}
				return {
					index,
					outpoint,
					owner: 'builder-funding',
					purpose: 'bsv-funding',
					sourceSatoshis: (sourceOutput.satoshis ?? 0).toString(),
					sourceScriptHash: scriptHash(sourceOutput.lockingScript),
				}
			}
			assets.delete(outpoint)
			return omitUndefined({
				index,
				outpoint,
				owner: asset.owner,
				purpose: asset.purpose,
				tokenId: asset.tokenId,
				tokenAmount: asset.tokenAmount,
				sourceSatoshis: asset.sourceSatoshis,
				sourceScriptHash: asset.sourceScriptHash,
			})
		},
	)
	if (assets.size > 0)
		throw new Error('settlement-template: agreed asset input missing')
	const manifestOutputs = matchExpectedOutputs(tx, expected)
	traceOrdinals(manifestInputs, manifestOutputs)
	const inputSatoshis = manifestInputs.reduce(
		(sum, input) => sum + BigInt(input.sourceSatoshis),
		0n,
	)
	const outputSatoshis = manifestOutputs.reduce(
		(sum, output) => sum + BigInt(output.satoshis),
		0n,
	)
	if (inputSatoshis <= outputSatoshis) {
		throw new Error('settlement-template: mining fee must be positive')
	}
	const overlayPolicies: TemplateOverlayPolicyV1[] = [...plan.overlayPolicies]
		.sort((a, b) => a.tokenId.localeCompare(b.tokenId))
		.map((policy) => {
			const countedOutputs = manifestOutputs.filter(
				(output) =>
					(output.purpose === 'bsv21-receipt' ||
						output.purpose === 'bsv21-change') &&
					output.tokenId === policy.tokenId,
			).length
			return {
				tokenId: policy.tokenId,
				statusCheckedAt: policy.statusCheckedAt,
				feeAddress: policy.feeAddress,
				feePerOutput: policy.feePerOutput,
				countedOutputs,
				totalFee: (
					BigInt(policy.feePerOutput) * BigInt(countedOutputs)
				).toString(),
			}
		})
	return {
		chain: plan.chain,
		builder: plan.builder,
		inputs: manifestInputs,
		outputs: manifestOutputs,
		overlayPolicies,
	}
}

export function reconstructSettlementTemplate(
	plan: SettlementPlanV1,
	signableBeef: number[],
	options: { now?: number; maxEvidenceAgeMs: number },
): SettlementTemplateV1 {
	const now = options.now ?? Date.now()
	if (signableBeef.length > MAX_SETTLEMENT_BEEF_BYTES) {
		throw new Error('settlement-template: signable BEEF exceeds size limit')
	}
	validateSettlementPlan(plan, {
		now,
		maxEvidenceAgeMs: options.maxEvidenceAgeMs,
	})
	const sourceBeefs = decodeSourceBeefs(plan)
	const sourceBeef = sourceBeefs.merged
	for (const input of allAssetInputs(plan))
		validateSource(sourceBeefs.byHash, input)
	const signable = Beef.fromBinary(signableBeef)
	sourceBeef.mergeBeef(signable)
	const subject = Transaction.fromBEEF(signableBeef)
	const tx = sourceBeef.findTransactionForSigning(subject.id('hex'))
	if (!tx)
		throw new Error(
			'settlement-template: cannot reconstruct signable transaction',
		)
	if (
		tx.inputs.length > MAX_SETTLEMENT_OUTPUTS ||
		tx.outputs.length > MAX_SETTLEMENT_OUTPUTS
	) {
		throw new Error('settlement-template: transaction exceeds entry limit')
	}
	const expected = expectedOutputs(plan, now, options.maxEvidenceAgeMs)
	const manifest = reconstructManifest(plan, tx, expected)
	return {
		manifest,
		signableBeef: Array.from(signableBeef),
	}
}

export async function prepareSettlementAction(
	wallet: WalletInterface,
	plan: SettlementPlanV1,
	options: { now?: number; maxEvidenceAgeMs: number },
): Promise<BuilderLocalSettlementActionV1> {
	const now = options.now ?? Date.now()
	validateSettlementPlan(plan, {
		now,
		maxEvidenceAgeMs: options.maxEvidenceAgeMs,
	})
	const sourceBeefs = decodeSourceBeefs(plan)
	const sourceBeef = sourceBeefs.merged
	const assets = orderedAssetInputs(plan)
	for (const input of assets) validateSource(sourceBeefs.byHash, input)
	const outputs = expectedOutputs(plan, now, options.maxEvidenceAgeMs)
	const createInputs: CreateActionInput[] = assets.map((input) => ({
		outpoint: input.outpoint.replace('_', '.'),
		inputDescription:
			input.purpose === 'ordinal'
				? `Atomic settlement ordinal ${input.outpoint}`
				: `Atomic settlement BSV21 ${input.tokenId}`,
		unlockingScriptLength: 108,
	}))
	const createOutputs: CreateActionOutput[] = outputs.map((output) => ({
		lockingScript: output.lockingScript,
		satoshis: Number(output.satoshis),
		outputDescription: `Atomic settlement ${output.purpose}`,
	}))
	const createResult = await wallet.createAction({
		description: 'Atomic two-party settlement',
		inputs: createInputs,
		inputBEEF: sourceBeef.toBinary(),
		outputs: createOutputs,
		options: { signAndProcess: false, randomizeOutputs: false },
	})
	const signable = createResult.signableTransaction
	if (!signable?.reference || !signable.tx) {
		throw new Error(
			'settlement-template: wallet did not return a signable action',
		)
	}
	try {
		const template = reconstructSettlementTemplate(
			plan,
			Array.from(signable.tx),
			{
				now,
				maxEvidenceAgeMs: options.maxEvidenceAgeMs,
			},
		)
		return { reference: signable.reference, createResult, template }
	} catch (error) {
		await wallet.abortAction({ reference: signable.reference }).catch(() => {})
		throw error
	}
}
