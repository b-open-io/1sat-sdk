import { describe, expect, test } from 'bun:test'
import {
	type SettlementSessionV1,
	advanceSettlementAttempt,
	createSettlementSession,
	updateSettlementSession,
} from '../src/settlement/index.js'
import vectors from './fixtures/brc178-exchange-vectors.json'
const A = `02${'1'.repeat(64)}`
const B = `03${'2'.repeat(64)}`
const parties: [string, string] = [A, B]
function initial() {
	let s = createSettlementSession({
		id: 'test-session',
		parties,
		chain: 'main',
		builder: B,
		maxMiningFeeSatoshis: '100',
		maxOverlayFeeSatoshis: '20',
	})
	for (const [i, actor] of parties.entries())
		s = updateSettlementSession(
			s,
			{
				sessionId: s.id,
				actor,
				revision: s.revision,
				sequence: 1,
				kind: 'edit',
				items: [{ kind: 'ordinal', outpoint: `${String(i + 1).repeat(64)}_0` }],
			},
			actor,
		).state
	return s
}
function ready(s: SettlementSessionV1, actor: string, sequence = 2) {
	return updateSettlementSession(
		s,
		{
			sessionId: s.id,
			actor,
			sequence,
			revision: s.revision,
			kind: 'ready',
			ready: true,
		},
		actor,
	)
}
describe('BRC-178 portable readiness traces', () => {
	for (const trace of vectors.stateTraces)
		test(trace.id, () => {
			let s = initial()
			for (const step of trace.steps) {
				const op = step.operation as {
					kind: string
					actor?: string
					sequence?: number
					revision?: number
					ready?: boolean
				}
				if (op.actor) {
					const actor = op.actor === 'alice' ? A : B
					const common = {
						sessionId: s.id,
						actor,
						sequence: op.sequence! + 1,
						revision: op.revision! + 2,
					}
					s = updateSettlementSession(
						s,
						op.kind === 'edit'
							? {
									...common,
									kind: 'edit',
									items: s.offers[parties.indexOf(actor)].items,
								}
							: { ...common, kind: 'ready', ready: op.ready! },
						actor,
					).state
				} else if (op.kind !== 'timeout') {
					s = advanceSettlementAttempt(s, {
						sessionId: s.id,
						attempt: s.attempt,
						kind:
							op.kind === 'signature-released'
								? 'signing-started'
								: op.kind === 'failure'
									? 'failed'
									: 'candidate-invalidated',
					})
				}
				expect({
					revision: s.revision - 2,
					ready: { alice: s.ready[0], bob: s.ready[1] },
					phase: s.phase,
					attempts: s.attempt,
				}).toEqual(step.expected)
			}
		})
})
test('actor authentication, session binding, bounds, and immutability', () => {
	const s = initial()
	const original = structuredClone(s)
	const op = {
		sessionId: s.id,
		actor: A,
		sequence: 2,
		revision: s.revision,
		kind: 'ready' as const,
		ready: true,
	}
	expect(() => updateSettlementSession(s, op, B)).toThrow('actor or session')
	expect(() =>
		updateSettlementSession(s, { ...op, sessionId: 'other' }, A),
	).toThrow('actor or session')
	expect(() =>
		updateSettlementSession(s, { ...op, sequence: Number.NaN }, A),
	).toThrow('ordering')
	expect(() =>
		updateSettlementSession(
			s,
			{ ...op, kind: 'edit', items: [{ kind: 'bsv', satoshis: '1' }] },
			A,
		),
	).toThrow('builder')
	expect(() =>
		updateSettlementSession(
			s,
			{ ...op, kind: 'edit', items: [{ kind: 'ordinal', outpoint: 'x' }] },
			A,
		),
	).toThrow('outpoint')
	const changed = ready(s, A).state
	expect(changed.ready).toEqual([true, false])
	expect(s).toEqual(original)
})
test('compare-and-swap allows one side effect for competing both-ready updates', () => {
	let stored = ready(initial(), A).state
	const before = stored
	const first = ready(before, B)
	const second = ready(before, B)
	let attempts = 0
	for (const transition of [first, second]) {
		if (stored.version !== before.version) continue
		stored = transition.state
		if (transition.outcome === 'attempt-started') attempts++
	}
	expect(attempts).toBe(1)
	expect(stored.phase).toBe('attempting')
})
test('settlement requires Bitcoin acceptance, token admission, and both receipts', () => {
	let s = initial()
	s = updateSettlementSession(
		s,
		{
			sessionId: s.id,
			actor: A,
			revision: s.revision,
			sequence: 2,
			kind: 'edit',
			items: [{ kind: 'bsv21', tokenId: `${'3'.repeat(64)}_0`, amount: '1' }],
		},
		A,
	).state
	s = ready(ready(s, A, 3).state, B).state
	const event = (
		kind:
			| 'signing-started'
			| 'bitcoin-accepted'
			| 'overlay-admitted'
			| 'failed',
	) => {
		s = advanceSettlementAttempt(s, {
			sessionId: s.id,
			attempt: s.attempt,
			kind,
		})
	}
	event('signing-started')
	event('bitcoin-accepted')
	event('failed')
	expect(s.phase).toBe('reconciling')
	expect(() =>
		advanceSettlementAttempt(s, {
			sessionId: s.id,
			attempt: s.attempt,
			kind: 'candidate-invalidated',
		}),
	).toThrow('accepted')
	for (const owner of parties)
		s = advanceSettlementAttempt(s, {
			sessionId: s.id,
			attempt: s.attempt,
			kind: 'receipt-internalized',
			owner,
		})
	expect(s.phase).toBe('reconciling')
	event('overlay-admitted')
	expect(s.phase).toBe('settled')
	expect(() =>
		advanceSettlementAttempt(s, {
			sessionId: s.id,
			attempt: s.attempt - 1,
			kind: 'failed',
		}),
	).toThrow('attempt')
})
