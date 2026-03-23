/**
 * Tests for the browser navigation state machine.
 *
 * The hook wraps a pure reducer — we test the reducer (applyNavAction) directly
 * so we don't need a React runtime or @testing-library/react.
 */
import { describe, expect, it } from 'bun:test'
import {
	applyNavAction,
	NAV_INITIAL_STATE,
	type NavAction,
	type NavState,
} from './use-browser-navigation'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function apply(state: NavState, ...actions: NavAction[]): NavState {
	let s = state
	for (const action of actions) {
		s = applyNavAction(s, action)
	}
	return s
}

// ─── Initial state ────────────────────────────────────────────────────────────

describe('NAV_INITIAL_STATE', () => {
	it('starts at wallet/overview', () => {
		expect(NAV_INITIAL_STATE.current).toEqual({
			type: 'internal',
			page: 'wallet/overview',
			params: {},
		})
	})

	it('starts with canGoBack false', () => {
		expect(NAV_INITIAL_STATE.canGoBack).toBe(false)
	})

	it('starts with canGoForward false', () => {
		expect(NAV_INITIAL_STATE.canGoForward).toBe(false)
	})
})

// ─── navigate action ──────────────────────────────────────────────────────────

describe('applyNavAction — navigate', () => {
	it('changes current route after navigate', () => {
		const state = apply(NAV_INITIAL_STATE, { type: 'navigate', input: '1sat://ordinals/gallery' })
		expect(state.current).toEqual({ type: 'internal', page: 'ordinals/gallery', params: {} })
	})

	it('sets canGoBack to true after one navigation', () => {
		const state = apply(NAV_INITIAL_STATE, { type: 'navigate', input: '1sat://settings' })
		expect(state.canGoBack).toBe(true)
	})

	it('keeps canGoForward false after a forward navigation', () => {
		const state = apply(NAV_INITIAL_STATE, { type: 'navigate', input: '1sat://settings' })
		expect(state.canGoForward).toBe(false)
	})

	it('truncates forward history when navigating mid-stack', () => {
		const state = apply(
			NAV_INITIAL_STATE,
			{ type: 'navigate', input: '1sat://ordinals/gallery' },
			{ type: 'navigate', input: '1sat://tokens/all' },
			{ type: 'back' },
			// Now at ordinals/gallery with forward pointing at tokens/all
			{ type: 'navigate', input: '1sat://settings' },
		)
		expect(state.canGoForward).toBe(false)
		expect(state.current).toEqual({ type: 'internal', page: 'settings', params: {} })
	})

	it('parses a web URL', () => {
		const state = apply(NAV_INITIAL_STATE, {
			type: 'navigate',
			input: 'https://example.com',
		})
		expect(state.current).toEqual({ type: 'web', url: 'https://example.com' })
	})

	it('falls back to search for unrecognised input', () => {
		const state = apply(NAV_INITIAL_STATE, { type: 'navigate', input: 'who is satoshi' })
		expect(state.current.type).toBe('search')
	})

	it('ignores null parses (empty string)', () => {
		const state = apply(NAV_INITIAL_STATE, { type: 'navigate', input: '' })
		expect(state.current).toEqual(NAV_INITIAL_STATE.current)
	})
})

// ─── back action ──────────────────────────────────────────────────────────────

describe('applyNavAction — back', () => {
	it('navigates back to the previous route', () => {
		const state = apply(
			NAV_INITIAL_STATE,
			{ type: 'navigate', input: '1sat://settings' },
			{ type: 'back' },
		)
		expect(state.current).toEqual({ type: 'internal', page: 'wallet/overview', params: {} })
	})

	it('sets canGoForward to true after going back', () => {
		const state = apply(
			NAV_INITIAL_STATE,
			{ type: 'navigate', input: '1sat://settings' },
			{ type: 'back' },
		)
		expect(state.canGoForward).toBe(true)
	})

	it('does nothing when already at the start of history', () => {
		const state = apply(NAV_INITIAL_STATE, { type: 'back' })
		expect(state.current).toEqual(NAV_INITIAL_STATE.current)
		expect(state.canGoBack).toBe(false)
	})
})

// ─── forward action ───────────────────────────────────────────────────────────

describe('applyNavAction — forward', () => {
	it('navigates forward after going back', () => {
		const state = apply(
			NAV_INITIAL_STATE,
			{ type: 'navigate', input: '1sat://settings' },
			{ type: 'back' },
			{ type: 'forward' },
		)
		expect(state.current).toEqual({ type: 'internal', page: 'settings', params: {} })
	})

	it('restores canGoBack after going forward', () => {
		const state = apply(
			NAV_INITIAL_STATE,
			{ type: 'navigate', input: '1sat://settings' },
			{ type: 'back' },
			{ type: 'forward' },
		)
		expect(state.canGoBack).toBe(true)
	})

	it('sets canGoForward false once at the end of the stack', () => {
		const state = apply(
			NAV_INITIAL_STATE,
			{ type: 'navigate', input: '1sat://settings' },
			{ type: 'back' },
			{ type: 'forward' },
		)
		expect(state.canGoForward).toBe(false)
	})

	it('does nothing when already at the end of history', () => {
		const state = apply(
			NAV_INITIAL_STATE,
			{ type: 'navigate', input: '1sat://settings' },
		)
		const afterForward = applyNavAction(state, { type: 'forward' })
		expect(afterForward.current).toEqual(state.current)
	})
})

// ─── multi-step navigation ────────────────────────────────────────────────────

describe('applyNavAction — multi-step history', () => {
	it('tracks a sequence of back/forward through three pages', () => {
		let state = apply(
			NAV_INITIAL_STATE,
			{ type: 'navigate', input: '1sat://ordinals/gallery' },
			{ type: 'navigate', input: '1sat://tokens/all' },
		)
		// history: overview → ordinals → tokens (current)

		state = applyNavAction(state, { type: 'back' })
		expect(state.current.type === 'internal' && state.current.page).toBe('ordinals/gallery')

		state = applyNavAction(state, { type: 'back' })
		expect(state.current.type === 'internal' && state.current.page).toBe('wallet/overview')
		expect(state.canGoBack).toBe(false)

		state = applyNavAction(state, { type: 'forward' })
		expect(state.current.type === 'internal' && state.current.page).toBe('ordinals/gallery')

		state = applyNavAction(state, { type: 'forward' })
		expect(state.current.type === 'internal' && state.current.page).toBe('tokens/all')
		expect(state.canGoForward).toBe(false)
	})
})
