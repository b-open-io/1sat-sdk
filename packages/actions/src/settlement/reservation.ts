import { digestSettlementObject } from './canonical.js'
import type {
	ReplayRecordV1,
	SettlementReplayStore,
	SettlementReservationAdapter,
	SettlementReservationLeaseV1,
	SettlementReservationRequestV1,
} from './types.js'
import { assertSettlementOutpoint } from './validate.js'

export async function reserveSettlementInputs(
	adapter: SettlementReservationAdapter,
	request: SettlementReservationRequestV1,
	now = Date.now(),
): Promise<SettlementReservationLeaseV1> {
	if (!request.settlementId || !request.offerDigest) {
		throw new Error('settlement-reservation: missing settlement commitment')
	}
	if (!Number.isSafeInteger(request.attempt) || request.attempt < 1) {
		throw new Error('settlement-reservation: invalid attempt')
	}
	if (!request.walletIdentity || !request.providerInstanceId) {
		throw new Error('settlement-reservation: wallet/provider binding required')
	}
	if (!Number.isSafeInteger(request.expiresAt) || request.expiresAt <= now) {
		throw new Error('settlement-reservation: invalid expiry')
	}
	if (request.outpoints.length === 0)
		throw new Error('settlement-reservation: no inputs')
	const unique = new Set(request.outpoints)
	if (unique.size !== request.outpoints.length) {
		throw new Error('settlement-reservation: duplicate input')
	}
	for (const outpoint of request.outpoints) assertSettlementOutpoint(outpoint)
	const canonicalRequest = {
		...request,
		outpoints: [...request.outpoints].sort(),
	}
	const lease = await adapter.reserve(canonicalRequest)
	if (
		!lease.reservationId ||
		lease.expiresAt > request.expiresAt ||
		lease.expiresAt <= now
	) {
		throw new Error('settlement-reservation: invalid lease')
	}
	if (
		digestSettlementObject(lease.request) !==
		digestSettlementObject(canonicalRequest)
	) {
		throw new Error('settlement-reservation: adapter changed request binding')
	}
	if (!(await adapter.validate(lease))) {
		throw new Error('settlement-reservation: lease not current')
	}
	return lease
}

export async function assertSettlementReservationCurrent(
	adapter: SettlementReservationAdapter,
	lease: SettlementReservationLeaseV1,
	now = Date.now(),
): Promise<void> {
	if (lease.expiresAt <= now || !(await adapter.validate(lease))) {
		throw new Error('settlement-reservation: stale lease')
	}
}

export class InMemorySettlementReplayStore implements SettlementReplayStore {
	private readonly records = new Map<string, ReplayRecordV1>()

	async load(key: string): Promise<ReplayRecordV1 | null> {
		return this.records.get(key) ?? null
	}

	async save(record: ReplayRecordV1): Promise<void> {
		this.records.set(record.key, record)
	}
}

/**
 * Idempotently records one settlement artifact. Identical bytes return false;
 * reusing the binding key for changed bytes fails closed.
 */
export async function recordSettlementArtifact(
	store: SettlementReplayStore,
	key: string,
	artifact: unknown,
	expiresAt: number,
	now = Date.now(),
): Promise<boolean> {
	if (!key || !Number.isSafeInteger(expiresAt) || expiresAt <= now) {
		throw new Error('settlement-replay: invalid key or expiry')
	}
	const digest = digestSettlementObject(artifact)
	const existing = await store.load(key)
	if (existing && existing.expiresAt > now) {
		if (existing.digest !== digest) {
			throw new Error(
				'settlement-replay: binding reused with different artifact',
			)
		}
		return false
	}
	await store.save({ key, digest, expiresAt })
	return true
}
