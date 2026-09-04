import {
	Beef,
	Hash,
	Script,
	Signature,
	Spend,
	Transaction,
	TransactionSignature,
	UnlockingScript,
	Utils,
	type WalletInterface,
} from '@bsv/sdk'
import {
	assertExactKeys,
	digestSettlementObject,
	hashSettlementBytes,
} from './canonical.js'
import { reconstructSettlementTemplate } from './template.js'
import type {
	BuilderLocalSettlementActionV1,
	SettlementAuthorizationV1,
	SettlementPlanV1,
	SettlementSigningMetadataV1,
	SettlementSigningRequestV1,
	SettlementTemplateV1,
} from './types.js'
import {
	SETTLEMENT_PROTOCOL,
	SETTLEMENT_SIGHASH_SCOPE,
	SETTLEMENT_VERSION,
} from './types.js'

function mergedSigningTransaction(
	plan: SettlementPlanV1,
	signableBeef: number[],
): Transaction {
	const beef = new Beef()
	for (const source of plan.sourceBEEFs)
		beef.mergeBeef(Beef.fromBinary(source.beef))
	beef.mergeBeef(Beef.fromBinary(signableBeef))
	const subject = Transaction.fromBEEF(signableBeef)
	const tx = beef.findTransactionForSigning(subject.id('hex'))
	if (!tx)
		throw new Error('settlement-signing: unable to build signing transaction')
	return tx
}

function inputPreimage(tx: Transaction, inputIndex: number): number[] {
	const input = tx.inputs[inputIndex]
	const source = input.sourceTransaction?.outputs[input.sourceOutputIndex]
	if (!source)
		throw new Error(
			`settlement-signing: missing source for input ${inputIndex}`,
		)
	const sourceTXID = input.sourceTXID ?? input.sourceTransaction?.id('hex')
	if (!sourceTXID)
		throw new Error(`settlement-signing: missing txid for input ${inputIndex}`)
	return TransactionSignature.format({
		sourceTXID,
		sourceOutputIndex: input.sourceOutputIndex,
		sourceSatoshis: source.satoshis ?? 0,
		transactionVersion: tx.version,
		otherInputs: tx.inputs
			.filter((_, index) => index !== inputIndex)
			.map((other) => ({
				sourceTXID:
					other.sourceTXID ?? other.sourceTransaction?.id('hex') ?? '',
				sourceOutputIndex: other.sourceOutputIndex,
				sequence: other.sequence ?? 0xffffffff,
			})),
		inputIndex,
		outputs: tx.outputs,
		inputSequence: input.sequence ?? 0xffffffff,
		subscript: source.lockingScript,
		lockTime: tx.lockTime,
		scope: SETTLEMENT_SIGHASH_SCOPE,
	})
}

function assertTemplateEqual(
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
		reconstructed.templateHash !== template.templateHash ||
		reconstructed.signableBeefHash !== template.signableBeefHash ||
		reconstructed.contributionHashes[0] !== template.contributionHashes[0] ||
		reconstructed.contributionHashes[1] !== template.contributionHashes[1] ||
		digestSettlementObject(reconstructed.manifest) !==
			digestSettlementObject(template.manifest)
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
		hashSettlementBytes(Array.from(signable.tx)) !==
			localAction.template.signableBeefHash
	) {
		throw new Error(
			'settlement-signing: builder action reference or transaction substitution',
		)
	}
}

export function createSettlementSigningRequest(
	plan: SettlementPlanV1,
	template: SettlementTemplateV1,
	owner: string,
	options: {
		now?: number
		maxEvidenceAgeMs: number
		authorizationExpiresAt: number
	},
): SettlementSigningRequestV1 {
	const now = options.now ?? Date.now()
	if (!plan.lockedOffer.parties.includes(owner)) {
		throw new Error('settlement-signing: signer is not a participant')
	}
	if (
		!Number.isSafeInteger(options.authorizationExpiresAt) ||
		options.authorizationExpiresAt <= now ||
		options.authorizationExpiresAt > plan.lockedOffer.expiresAt
	) {
		throw new Error('settlement-signing: invalid authorization expiry')
	}
	const reconstructed = assertTemplateEqual(plan, template, {
		now,
		maxEvidenceAgeMs: options.maxEvidenceAgeMs,
	})
	const tx = mergedSigningTransaction(plan, reconstructed.signableBeef)
	const owned = reconstructed.manifest.inputs.filter(
		(input) => input.owner === owner,
	)
	if (owned.length === 0)
		throw new Error('settlement-signing: owner has no asset inputs')
	return {
		protocol: SETTLEMENT_PROTOCOL,
		version: SETTLEMENT_VERSION,
		chain: plan.lockedOffer.chain,
		sessionId: plan.lockedOffer.sessionId,
		settlementId: plan.settlementId,
		attempt: plan.attempt,
		offerDigest: plan.offerDigest,
		templateHash: reconstructed.templateHash,
		contributionHash: plan.contributions.find(
			(contribution) => contribution.owner === owner,
		)!.contributionHash,
		owner,
		authorizationExpiresAt: options.authorizationExpiresAt,
		inputs: owned.map((input) => {
			const preimage = inputPreimage(tx, input.index)
			return {
				inputIndex: input.index,
				outpoint: input.outpoint,
				preimage,
				sighash: Hash.sha256(Hash.sha256(preimage)),
				sighashScope: SETTLEMENT_SIGHASH_SCOPE,
			}
		}),
	}
}

function verifyRequest(
	request: SettlementSigningRequestV1,
	plan: SettlementPlanV1,
	template: SettlementTemplateV1,
	tx: Transaction,
	now: number,
): void {
	assertExactKeys(
		request as unknown as Record<string, unknown>,
		[
			'protocol',
			'version',
			'chain',
			'sessionId',
			'settlementId',
			'attempt',
			'offerDigest',
			'templateHash',
			'contributionHash',
			'owner',
			'authorizationExpiresAt',
			'inputs',
		],
		[],
		'settlement-signing request',
	)
	if (!Array.isArray(request.inputs)) {
		throw new Error('settlement-signing: inputs must be an array')
	}
	for (const [index, input] of request.inputs.entries()) {
		if (!input || typeof input !== 'object' || Array.isArray(input)) {
			throw new Error(`settlement-signing: invalid input ${index}`)
		}
		assertExactKeys(
			input as unknown as Record<string, unknown>,
			['inputIndex', 'outpoint', 'preimage', 'sighash', 'sighashScope'],
			[],
			`settlement-signing input ${index}`,
		)
		if (
			!Array.isArray(input.preimage) ||
			!input.preimage.every(
				(byte) => Number.isSafeInteger(byte) && byte >= 0 && byte <= 255,
			) ||
			!Array.isArray(input.sighash) ||
			input.sighash.length !== 32 ||
			!input.sighash.every(
				(byte) => Number.isSafeInteger(byte) && byte >= 0 && byte <= 255,
			)
		) {
			throw new Error(
				`settlement-signing: invalid signing bytes for input ${index}`,
			)
		}
	}
	if (
		request.protocol !== SETTLEMENT_PROTOCOL ||
		request.version !== SETTLEMENT_VERSION ||
		request.chain !== plan.lockedOffer.chain ||
		request.sessionId !== plan.lockedOffer.sessionId ||
		request.settlementId !== plan.settlementId ||
		request.attempt !== plan.attempt ||
		request.offerDigest !== plan.offerDigest ||
		request.templateHash !== template.templateHash ||
		request.contributionHash !==
			plan.contributions.find(
				(contribution) => contribution.owner === request.owner,
			)?.contributionHash ||
		request.authorizationExpiresAt <= now ||
		request.authorizationExpiresAt > plan.lockedOffer.expiresAt
	) {
		throw new Error('settlement-signing: stale or rebound signing request')
	}
	const owned = template.manifest.inputs.filter(
		(input) => input.owner === request.owner,
	)
	if (owned.length !== request.inputs.length) {
		throw new Error('settlement-signing: incomplete owned input set')
	}
	for (const [position, manifestInput] of owned.entries()) {
		const requested = request.inputs[position]
		const expectedPreimage = inputPreimage(tx, manifestInput.index)
		if (
			requested.inputIndex !== manifestInput.index ||
			requested.outpoint !== manifestInput.outpoint ||
			requested.sighashScope !== SETTLEMENT_SIGHASH_SCOPE ||
			hashSettlementBytes(requested.preimage) !==
				hashSettlementBytes(expectedPreimage) ||
			hashSettlementBytes(requested.sighash) !==
				hashSettlementBytes(Hash.sha256(Hash.sha256(expectedPreimage)))
		) {
			throw new Error('settlement-signing: preimage or input substitution')
		}
	}
}

function buildPushDropUnlock(signature: number[]): string {
	const bare = Signature.fromDER(signature)
	const transactionSignature = new TransactionSignature(
		bare.r,
		bare.s,
		SETTLEMENT_SIGHASH_SCOPE,
	)
	const checksig = transactionSignature.toChecksigFormat()
	return new UnlockingScript([{ op: checksig.length, data: checksig }]).toHex()
}

async function buildP2pkhUnlock(
	wallet: WalletInterface,
	metadata: SettlementSigningMetadataV1,
	signature: number[],
): Promise<string> {
	const counterparty = metadata.counterparty ?? 'self'
	const { publicKey } = await wallet.getPublicKey({
		protocolID: metadata.protocolID,
		keyID: metadata.keyID,
		counterparty,
		forSelf: true,
	})
	return new UnlockingScript()
		.writeBin([...signature, SETTLEMENT_SIGHASH_SCOPE])
		.writeBin(Utils.toArray(publicKey, 'hex'))
		.toHex()
}

function verifyUnlock(
	tx: Transaction,
	inputIndex: number,
	unlockingScript: string,
): void {
	const input = tx.inputs[inputIndex]
	const source = input.sourceTransaction?.outputs[input.sourceOutputIndex]
	if (!source)
		throw new Error('settlement-signing: source missing during verification')
	const unlock = Script.fromHex(unlockingScript)
	input.unlockingScript = unlock
	const spend = new Spend({
		sourceTXID: input.sourceTXID ?? input.sourceTransaction?.id('hex') ?? '',
		sourceOutputIndex: input.sourceOutputIndex,
		lockingScript: source.lockingScript,
		sourceSatoshis: source.satoshis ?? 0,
		transactionVersion: tx.version,
		otherInputs: tx.inputs.filter((_, index) => index !== inputIndex),
		unlockingScript: unlock,
		inputSequence: input.sequence ?? 0xffffffff,
		inputIndex,
		outputs: tx.outputs,
		lockTime: tx.lockTime,
	})
	if (!spend.validate()) {
		throw new Error(
			`settlement-signing: script verification failed for input ${inputIndex}`,
		)
	}
}

export async function authorizeSettlementInputs(
	wallet: WalletInterface,
	plan: SettlementPlanV1,
	template: SettlementTemplateV1,
	request: SettlementSigningRequestV1,
	metadata: SettlementSigningMetadataV1[],
	options: { now?: number; maxEvidenceAgeMs: number },
): Promise<SettlementAuthorizationV1> {
	const now = options.now ?? Date.now()
	const reconstructed = assertTemplateEqual(plan, template, {
		now,
		maxEvidenceAgeMs: options.maxEvidenceAgeMs,
	})
	const tx = mergedSigningTransaction(plan, reconstructed.signableBeef)
	verifyRequest(request, plan, reconstructed, tx, now)
	const byIndex = new Map(metadata.map((entry) => [entry.inputIndex, entry]))
	if (
		byIndex.size !== metadata.length ||
		metadata.length !== request.inputs.length
	) {
		throw new Error(
			'settlement-signing: signing metadata must exactly cover owned inputs',
		)
	}
	const spends: Record<number, { unlockingScript: string }> = {}
	for (const requested of request.inputs) {
		const meta = byIndex.get(requested.inputIndex)
		if (!meta)
			throw new Error('settlement-signing: missing local signing metadata')
		const counterparty =
			meta.counterparty ?? (meta.template === 'pushdrop' ? 'anyone' : 'self')
		const { signature } = await wallet.createSignature({
			protocolID: meta.protocolID,
			keyID: meta.keyID,
			counterparty,
			data: requested.preimage,
			hashToDirectlySign: requested.sighash,
		})
		const unlockingScript =
			meta.template === 'pushdrop'
				? buildPushDropUnlock(Array.from(signature))
				: await buildP2pkhUnlock(wallet, meta, Array.from(signature))
		verifyUnlock(tx, requested.inputIndex, unlockingScript)
		spends[requested.inputIndex] = { unlockingScript }
	}
	return {
		offerDigest: plan.offerDigest,
		templateHash: reconstructed.templateHash,
		contributionHash: request.contributionHash,
		owner: request.owner,
		authorizedInputs: Object.entries(spends).map(([index, spend]) => ({
			inputIndex: Number(index),
			unlockingScriptHash: hashSettlementBytes(
				Utils.toArray(spend.unlockingScript, 'hex'),
			),
		})),
		authorizationExpiresAt: request.authorizationExpiresAt,
		spends,
	}
}

export async function finalizeSettlementAction(
	wallet: WalletInterface,
	plan: SettlementPlanV1,
	localAction: BuilderLocalSettlementActionV1,
	authorizations: SettlementAuthorizationV1[],
	options: { now?: number; maxEvidenceAgeMs: number },
) {
	const now = options.now ?? Date.now()
	const spends: Record<number, { unlockingScript: string }> = {}
	try {
		assertLocalActionBinding(localAction)
		const reconstructed = assertTemplateEqual(plan, localAction.template, {
			now,
			maxEvidenceAgeMs: options.maxEvidenceAgeMs,
		})
		if (authorizations.length !== 2) {
			throw new Error(
				'settlement-signing: both participant authorizations required',
			)
		}
		const tx = mergedSigningTransaction(plan, reconstructed.signableBeef)
		const owners = new Set<string>()
		for (const authorization of authorizations) {
			assertExactKeys(
				authorization as unknown as Record<string, unknown>,
				[
					'offerDigest',
					'templateHash',
					'contributionHash',
					'owner',
					'authorizedInputs',
					'authorizationExpiresAt',
					'spends',
				],
				[],
				'settlement authorization',
			)
			if (
				authorization.offerDigest !== plan.offerDigest ||
				authorization.templateHash !== reconstructed.templateHash ||
				authorization.contributionHash !==
					plan.contributions.find(
						(contribution) => contribution.owner === authorization.owner,
					)?.contributionHash ||
				authorization.authorizationExpiresAt <= now ||
				authorization.authorizationExpiresAt > plan.lockedOffer.expiresAt ||
				!plan.lockedOffer.parties.includes(authorization.owner) ||
				owners.has(authorization.owner)
			) {
				throw new Error(
					'settlement-signing: stale, replayed, or substituted authorization',
				)
			}
			owners.add(authorization.owner)
			const expected = reconstructed.manifest.inputs
				.filter((input) => input.owner === authorization.owner)
				.map((input) => input.index)
			const actual = Object.keys(authorization.spends)
				.map(Number)
				.sort((a, b) => a - b)
			if (
				expected.length !== actual.length ||
				expected.some((value, i) => value !== actual[i]) ||
				authorization.authorizedInputs.length !== actual.length
			) {
				throw new Error('settlement-signing: authorization input set mismatch')
			}
			for (const [position, index] of actual.entries()) {
				const spend = authorization.spends[index]
				const claimed = authorization.authorizedInputs[position]
				assertExactKeys(
					claimed as unknown as Record<string, unknown>,
					['inputIndex', 'unlockingScriptHash'],
					[],
					`settlement authorization input ${position}`,
				)
				assertExactKeys(
					spend as unknown as Record<string, unknown>,
					['unlockingScript'],
					[],
					`settlement authorization spend ${index}`,
				)
				if (
					claimed.inputIndex !== index ||
					claimed.unlockingScriptHash !==
						hashSettlementBytes(Utils.toArray(spend.unlockingScript, 'hex')) ||
					spends[index]
				) {
					throw new Error('settlement-signing: unlocking artifact substitution')
				}
				verifyUnlock(tx, index, spend.unlockingScript)
				spends[index] = spend
			}
		}
		const assetIndexes = reconstructed.manifest.inputs
			.filter((input) => input.purpose !== 'bsv-funding')
			.map((input) => input.index)
		if (assetIndexes.some((index) => !spends[index])) {
			throw new Error('settlement-signing: not every asset input is authorized')
		}
	} catch (error) {
		await wallet
			.abortAction({ reference: localAction.reference })
			.catch(() => {})
		throw error
	}
	return wallet.signAction({
		reference: localAction.reference,
		spends,
		options: { acceptDelayedBroadcast: false },
	})
}
