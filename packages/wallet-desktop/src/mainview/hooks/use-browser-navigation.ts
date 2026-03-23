import { useCallback, useReducer } from 'react'
import type { InternalPage, ParsedRoute } from '../../shared/url-types'
import { parseUrl } from '../lib/url-parser'

// ─── State & action types ─────────────────────────────────────────────────────

export interface NavState {
	/** History entries before the current position */
	back: ParsedRoute[]
	/** Currently displayed route */
	current: ParsedRoute
	/** History entries after the current position (forward stack) */
	forward: ParsedRoute[]
	canGoBack: boolean
	canGoForward: boolean
}

export type NavAction =
	| { type: 'navigate'; input: string }
	| { type: 'back' }
	| { type: 'forward' }

// ─── Initial state ────────────────────────────────────────────────────────────

const DEFAULT_PAGE: InternalPage = 'wallet/overview'

export const NAV_INITIAL_STATE: NavState = {
	back: [],
	current: { type: 'internal', page: DEFAULT_PAGE, params: {} },
	forward: [],
	canGoBack: false,
	canGoForward: false,
}

// ─── Pure reducer ─────────────────────────────────────────────────────────────

/**
 * Apply a navigation action to the current state, returning a new state.
 * This is exported so it can be unit-tested without a React runtime.
 */
export function applyNavAction(state: NavState, action: NavAction): NavState {
	switch (action.type) {
		case 'navigate': {
			const parsed = parseUrl(action.input)
			// Ignore unparseable input rather than corrupting state
			if (!parsed) return state
			const back = [...state.back, state.current]
			return {
				back,
				current: parsed,
				forward: [], // navigating truncates forward history
				canGoBack: true,
				canGoForward: false,
			}
		}

		case 'back': {
			if (state.back.length === 0) return state
			const back = state.back.slice(0, -1)
			const current = state.back[state.back.length - 1]
			const forward = [state.current, ...state.forward]
			return {
				back,
				current,
				forward,
				canGoBack: back.length > 0,
				canGoForward: true,
			}
		}

		case 'forward': {
			if (state.forward.length === 0) return state
			const [current, ...forward] = state.forward
			const back = [...state.back, state.current]
			return {
				back,
				current,
				forward,
				canGoBack: true,
				canGoForward: forward.length > 0,
			}
		}
	}
}

// ─── Public hook interface ────────────────────────────────────────────────────

export interface UseBrowserNavigationReturn {
	route: ParsedRoute
	navigate: (input: string) => void
	navigateInternal: (page: InternalPage) => void
	goBack: () => void
	goForward: () => void
	canGoBack: boolean
	canGoForward: boolean
}

/**
 * Browser navigation hook with full history stack (back / forward).
 *
 * Starts at `1sat://wallet/overview`. All navigation is driven by URL strings
 * understood by `parseUrl()`.
 */
export function useBrowserNavigation(): UseBrowserNavigationReturn {
	const [state, dispatch] = useReducer(applyNavAction, NAV_INITIAL_STATE)

	const navigate = useCallback((input: string) => {
		dispatch({ type: 'navigate', input })
	}, [])

	const navigateInternal = useCallback((page: InternalPage) => {
		dispatch({ type: 'navigate', input: `1sat://${page}` })
	}, [])

	const goBack = useCallback(() => {
		dispatch({ type: 'back' })
	}, [])

	const goForward = useCallback(() => {
		dispatch({ type: 'forward' })
	}, [])

	return {
		route: state.current,
		navigate,
		navigateInternal,
		goBack,
		goForward,
		canGoBack: state.canGoBack,
		canGoForward: state.canGoForward,
	}
}
