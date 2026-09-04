import {
	Beef,
	Script,
	Transaction,
	TransactionSignature,
	type WalletInterface,
} from '@bsv/sdk'
import { createContext } from '../types.js'
import { completeSignedAction } from '../utils/completeSignedAction.js'
import { signOrdinalInput } from '../utils/signOrdinalInput.js'
import { assertValidInputUnlock } from '../utils/verifyInputUnlock.js'
import { assertExactKeys } from './canonical.js'
import { reconstructSettlementTemplate } from './template.js'
import type {
	BuilderLocalSettlementActionV1,
	SettlementAuthorizationV1,
	SettlementPlanV1,
	SettlementSigningMetadataV1,
	SettlementTemplateV1,
} from './types.js'

/** Settlement supports the single-signature PushDrop and P2PKH unlock forms. */
function assertSettlementSignature(unlockingScript: string): void {
	if (
		!/^(?:[0-9a-f]{2})+$/.test(unlockingScript) ||
		unlockingScript.length > 216
	) {
		throw new Error('settlement-signing: unsupported unlocking script')
	}
	const chunks = Script.fromHex(unlockingScript).chunks
	const signature = chunks[0]?.data
	const publicKey = chunks[1]?.data
	if (
		(chunks.length !== 1 && chunks.length !== 2) ||
		chunks.some((chunk) => !chunk.data || chunk.op !== chunk.data.length) ||
		!signature ||
		signature.length < 9 ||
		signature.length > 73 ||
		(chunks.length === 2 &&
			(!publicKey ||
				!(
					publicKey.length === 33 &&
					(publicKey[0] === 2 || publicKey[0] === 3)
				)))
	) {
		throw new Error('settlement-signing: unsupported unlocking script')
	}
	if (TransactionSignature.fromChecksigFormat(signature).scope !== 0x41) {
		throw new Error(
			'settlement-signing: signature must use SIGHASH_ALL | SIGHASH_FORKID (0x41)',
		)
	}
}

function mergedSourceBeef(plan: SettlementPlanV1): Beef {
	const beef = new Beef()
	for (const source of plan.sourceBEEFs) {
		beef.mergeBeef(Beef.fromBinary(source.beef))
	}
	return beef
}

function mergedSigningTransaction(
	plan: SettlementPlanV1,
	signableBeef: number[],
): Transaction {
	const beef = mergedSourceBeef(plan)
	beef.mergeBeef(Beef.fromBinary(signableBeef))
	const subject = Transaction.fromBEEF(signableBeef)
	const tx = beef.findTransactionForSigning(subject.id('hex'))
	if (!tx) {
		throw new Error('settlement-signing: unable to build signing transaction')
	}
	return tx
}

function reconstructTemplate(
	plan: SettlementPlanV1,
	template: SettlementTemplateV1,
	options: { now: number; maxEvidenceAgeMs: number },
): SettlementTemplateV1 {
	const reconstructed = reconstructSettlementTemplate(
		plan,
		template.signableBeef,
		options,
	)
	if (
		JSON.stringify(reconstructed.manifest) !== JSON.stringify(template.manifest)
	) {
		throw new Error('settlement-signing: template substitution')
	}
	return reconstructed
}

function assertLocalActionBinding(
	localAction: BuilderLocalSettlementActionV1,
): void {
	const signable = localAction.createResult.signableTransaction
	if (
		!signable?.reference ||
		!signable.tx ||
		signable.reference !== localAction.reference ||
		signable.tx.length !== localAction.template.signableBeef.length ||
		Array.from(signable.tx).some(
			(value, index) => value !== localAction.template.signableBeef[index],
		)
	) {
		throw new Error(
			'settlement-signing: builder action reference or transaction substitution',
		)
	}
}

export async function authorizeSettlementInputs(
	wallet: WalletInterface,
	plan: SettlementPlanV1,
	template: SettlementTemplateV1,
	owner: string,
	metadata: SettlementSigningMetadataV1[],
	options: {
		now?: number
		maxEvidenceAgeMs: number
	},
): Promise<SettlementAuthorizationV1> {
	const now = options.now ?? Date.now()
	if (!plan.parties.includes(owner)) {
		throw new Error('settlement-signing: invalid signer')
	}
	const reconstructed = reconstructTemplate(plan, template, {
		now,
		maxEvidenceAgeMs: options.maxEvidenceAgeMs,
	})
	const tx = mergedSigningTransaction(plan, reconstructed.signableBeef)
	const ownedInputs = reconstructed.manifest.inputs.filter(
		(input) => input.owner === owner,
	)
	if (ownedInputs.length === 0) {
		throw new Error('settlement-signing: owner has no asset inputs')
	}
	const byIndex = new Map(metadata.map((entry) => [entry.inputIndex, entry]))
	if (
		byIndex.size !== metadata.length ||
		metadata.length !== ownedInputs.length
	) {
		throw new Error(
			'settlement-signing: signing metadata must exactly cover owned inputs',
		)
	}

	const context = createContext(wallet, { chain: plan.chain })
	const spends: Record<number, { unlockingScript: string }> = {}
	for (const input of ownedInputs) {
		const metadataForInput = byIndex.get(input.index)
		if (!metadataForInput) {
			throw new Error('settlement-signing: missing local signing metadata')
		}
		const unlockingScript = await signOrdinalInput(
			context,
			tx,
			input.index,
			JSON.stringify({
				protocolID: metadataForInput.protocolID,
				keyID: metadataForInput.keyID,
				counterparty: metadataForInput.counterparty,
			}),
		)
		if (typeof unlockingScript !== 'string') {
			throw new Error(`settlement-signing: ${unlockingScript.error}`)
		}
		assertSettlementSignature(unlockingScript)
		assertValidInputUnlock(tx, input.index, unlockingScript)
		spends[input.index] = { unlockingScript }
	}
	return {
		owner,
		spends,
	}
}

function collectAuthorizedSpends(
	template: SettlementTemplateV1,
	authorizations: SettlementAuthorizationV1[],
): Record<number, { unlockingScript: string }> {
	const expectedOwners = new Set(
		template.manifest.inputs
			.filter((input) => input.purpose !== 'bsv-funding')
			.map((input) => input.owner),
	)
	if (authorizations.length !== expectedOwners.size) {
		throw new Error(
			'settlement-signing: every asset owner authorization required',
		)
	}
	const spends: Record<number, { unlockingScript: string }> = {}
	const owners = new Set<string>()
	for (const authorization of authorizations) {
		assertExactKeys(
			authorization as unknown as Record<string, unknown>,
			['owner', 'spends'],
			[],
			'settlement authorization',
		)
		if (
			!expectedOwners.has(authorization.owner) ||
			owners.has(authorization.owner)
		) {
			throw new Error(
				'settlement-signing: duplicated or substituted authorization',
			)
		}
		owners.add(authorization.owner)
		const expected = template.manifest.inputs
			.filter((input) => input.owner === authorization.owner)
			.map((input) => input.index)
		const actual = Object.keys(authorization.spends)
			.map(Number)
			.sort((a, b) => a - b)
		if (
			expected.length !== actual.length ||
			expected.some((value, index) => value !== actual[index])
		) {
			throw new Error('settlement-signing: authorization input set mismatch')
		}
		for (const index of actual) {
			const spend = authorization.spends[index]
			assertExactKeys(
				spend as unknown as Record<string, unknown>,
				['unlockingScript'],
				[],
				`settlement authorization spend ${index}`,
			)
			if (typeof spend.unlockingScript !== 'string' || spends[index]) {
				throw new Error('settlement-signing: unlocking artifact substitution')
			}
			assertSettlementSignature(spend.unlockingScript)
			spends[index] = spend
		}
	}
	const assetIndexes = template.manifest.inputs
		.filter((input) => input.purpose !== 'bsv-funding')
		.map((input) => input.index)
	if (assetIndexes.some((index) => !spends[index])) {
		throw new Error('settlement-signing: not every asset input is authorized')
	}
	return spends
}

export async function finalizeSettlementAction(
	wallet: WalletInterface,
	plan: SettlementPlanV1,
	localAction: BuilderLocalSettlementActionV1,
	authorizations: SettlementAuthorizationV1[],
	options: { now?: number; maxEvidenceAgeMs: number },
) {
	const now = options.now ?? Date.now()
	let inputBeef: number[]
	try {
		assertLocalActionBinding(localAction)
		inputBeef = mergedSourceBeef(plan).toBinary()
	} catch (error) {
		await wallet
			.abortAction({ reference: localAction.reference })
			.catch(() => {})
		throw error
	}

	return completeSignedAction(
		wallet,
		localAction.createResult,
		inputBeef,
		async () => {
			const reconstructed = reconstructTemplate(plan, localAction.template, {
				now,
				maxEvidenceAgeMs: options.maxEvidenceAgeMs,
			})
			return collectAuthorizedSpends(reconstructed, authorizations)
		},
	)
}
