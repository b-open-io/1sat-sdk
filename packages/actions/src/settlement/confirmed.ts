import type { WalletInterface } from '@bsv/sdk'
import {
	type SettlementSessionV1,
	assertSettlementSessionFees,
	assertSettlementSessionPlan,
} from './session.js'
import {
	authorizeSettlementInputs,
	finalizeSettlementAction,
} from './signing.js'
import {
	prepareSettlementAction,
	reconstructSettlementTemplate,
} from './template.js'
import type {
	BuilderLocalSettlementActionV1,
	SettlementAuthorizationV1,
	SettlementPlanV1,
	SettlementSigningMetadataV1,
	SettlementTemplateV1,
} from './types.js'
import { validateSettlementPlan } from './validate.js'

export interface SettlementSessionCandidateV1 {
	sessionId: string
	attempt: number
	revision: number
	template: SettlementTemplateV1
}

export interface SettlementSessionReviewOptions {
	now?: number
	maxEvidenceAgeMs: number
	/** Required wallet-local adapter. Throw unless provenance/lineage, spent status,
	 * receiver destinations and fee policy are independently verified. Keep complete
	 * asset proofs in this adapter; sourceBEEFs are transaction-signing data only.
	 * Never obtain this callback or its trust policy from the counterparty.
	 */
	verifyEvidence: (
		plan: Readonly<SettlementPlanV1>,
		candidate?: Readonly<SettlementTemplateV1>,
	) => Promise<void>
}

async function verify(
	plan: SettlementPlanV1,
	options: SettlementSessionReviewOptions,
	candidate?: SettlementTemplateV1,
): Promise<void> {
	validateSettlementPlan(plan, options)
	if (typeof options.verifyEvidence !== 'function')
		throw new Error('settlement-session: trusted evidence verifier required')
	await options.verifyEvidence(
		structuredClone(plan),
		candidate ? structuredClone(candidate) : undefined,
	)
	// A slow evidence fetch or wallet prompt must not extend a stale timestamp.
	validateSettlementPlan(plan, { ...options, now: options.now ?? Date.now() })
}

function review(
	state: SettlementSessionV1,
	plan: SettlementPlanV1,
	candidate: SettlementSessionCandidateV1,
	options: SettlementSessionReviewOptions,
): void {
	if (
		candidate.sessionId !== state.id ||
		candidate.attempt !== state.attempt ||
		candidate.revision !== state.revision
	)
		throw new Error('settlement-session: candidate belongs to another attempt')
	assertSettlementSessionPlan(state, plan)
	const reconstructed = reconstructSettlementTemplate(
		plan,
		candidate.template.signableBeef,
		options,
	)
	if (
		JSON.stringify(reconstructed.manifest) !==
		JSON.stringify(candidate.template.manifest)
	)
		throw new Error('settlement-session: candidate review substitution')
	assertSettlementSessionFees(state, reconstructed)
}

/** Invoke once, after winning and persisting the both-ready transition. */
export async function prepareConfirmedSettlement(
	wallet: WalletInterface,
	state: SettlementSessionV1,
	plan: SettlementPlanV1,
	options: SettlementSessionReviewOptions,
): Promise<{
	localAction: BuilderLocalSettlementActionV1
	candidate: SettlementSessionCandidateV1
}> {
	const snapshot = structuredClone({ state, plan })
	if (snapshot.state.signingStarted)
		throw new Error('settlement-session: cannot rebuild after signing started')
	assertSettlementSessionPlan(snapshot.state, snapshot.plan)
	await verify(snapshot.plan, options)
	const localAction = await prepareSettlementAction(
		wallet,
		snapshot.plan,
		options,
	)
	try {
		const candidate = {
			sessionId: snapshot.state.id,
			attempt: snapshot.state.attempt,
			revision: snapshot.state.revision,
			template: localAction.template,
		}
		review(snapshot.state, snapshot.plan, candidate, options)
		await verify(snapshot.plan, options, candidate.template)
		return { localAction, candidate }
	} catch (error) {
		await wallet
			.abortAction({ reference: localAction.reference })
			.catch(() => {})
		throw error
	}
}

/** Persist signing-started before invoking, and serialize local cancellation with
 * this call. A failure thereafter must enter reconciliation, not clear readiness.
 */
export async function authorizeConfirmedSettlement(
	wallet: WalletInterface,
	state: SettlementSessionV1,
	plan: SettlementPlanV1,
	candidate: SettlementSessionCandidateV1,
	owner: string,
	metadata: SettlementSigningMetadataV1[],
	options: SettlementSessionReviewOptions,
): Promise<SettlementAuthorizationV1> {
	const snapshot = structuredClone({ state, plan, candidate, metadata })
	if (!snapshot.state.signingStarted)
		throw new Error(
			'settlement-session: persist signing-started before signing',
		)
	review(snapshot.state, snapshot.plan, snapshot.candidate, options)
	await verify(snapshot.plan, options, snapshot.candidate.template)
	return authorizeSettlementInputs(
		wallet,
		snapshot.plan,
		snapshot.candidate.template,
		owner,
		snapshot.metadata,
		options,
	)
}

/** Pass the retained local action only on the builder; relay candidate only. */
export async function finalizeConfirmedSettlement(
	wallet: WalletInterface,
	state: SettlementSessionV1,
	plan: SettlementPlanV1,
	prepared: {
		localAction: BuilderLocalSettlementActionV1
		candidate: SettlementSessionCandidateV1
	},
	authorizations: SettlementAuthorizationV1[],
	options: SettlementSessionReviewOptions,
) {
	const snapshot = structuredClone({ state, plan, prepared, authorizations })
	try {
		if (!snapshot.state.signingStarted)
			throw new Error(
				'settlement-session: persist signing-started before signing',
			)
		review(snapshot.state, snapshot.plan, snapshot.prepared.candidate, options)
		if (
			JSON.stringify(snapshot.prepared.candidate.template) !==
			JSON.stringify(snapshot.prepared.localAction.template)
		)
			throw new Error('settlement-session: local candidate substitution')
		await verify(snapshot.plan, options, snapshot.prepared.candidate.template)
	} catch (error) {
		await wallet
			.abortAction({ reference: snapshot.prepared.localAction.reference })
			.catch(() => {})
		throw error
	}
	return finalizeSettlementAction(
		wallet,
		snapshot.plan,
		snapshot.prepared.localAction,
		snapshot.authorizations,
		options,
	)
}
