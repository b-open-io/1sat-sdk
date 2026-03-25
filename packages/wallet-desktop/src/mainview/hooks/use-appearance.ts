import { useCallback, useEffect, useState } from 'react'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AppearanceMode = 'light' | 'dark' | 'system'
export type ResolvedTheme = 'light' | 'dark'

export interface UseAppearanceReturn {
	/** The user-selected mode (may be 'system') */
	mode: AppearanceMode
	/** Set the appearance mode and persist to localStorage */
	setMode: (mode: AppearanceMode) => void
	/** The actual applied theme — never 'system' */
	resolvedTheme: ResolvedTheme
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BASE_STORAGE_KEY = '1sat-appearance-mode'

function storageKey(accountId?: string): string {
	return accountId ? `${BASE_STORAGE_KEY}-${accountId}` : BASE_STORAGE_KEY
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getSystemPreference(): ResolvedTheme {
	if (typeof window === 'undefined') return 'dark'
	return window.matchMedia('(prefers-color-scheme: dark)').matches
		? 'dark'
		: 'light'
}

function resolve(mode: AppearanceMode): ResolvedTheme {
	if (mode === 'system') return getSystemPreference()
	return mode
}

function applyThemeClass(resolved: ResolvedTheme): void {
	if (typeof document === 'undefined') return
	const root = document.documentElement
	if (resolved === 'dark') {
		root.classList.add('dark')
		root.classList.remove('light')
	} else {
		root.classList.add('light')
		root.classList.remove('dark')
	}
}

function readStoredMode(accountId?: string): AppearanceMode {
	if (typeof window === 'undefined') return 'system'
	const stored = localStorage.getItem(storageKey(accountId))
	if (stored === 'light' || stored === 'dark' || stored === 'system') {
		return stored
	}
	// Fall back to global preference if no per-account setting
	if (accountId) {
		const global = localStorage.getItem(BASE_STORAGE_KEY)
		if (global === 'light' || global === 'dark' || global === 'system') {
			return global
		}
	}
	return 'system'
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Manages the app appearance (light/dark/system) with localStorage persistence.
 *
 * - Reads the saved preference on mount and applies the correct .dark/.light class
 * - Listens to system preference changes when mode is 'system'
 * - Exposes resolvedTheme for consumers that need the actual applied value
 */
export function useAppearance(accountId?: string): UseAppearanceReturn {
	const [mode, setModeState] = useState<AppearanceMode>(() => readStoredMode(accountId))
	const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() =>
		resolve(readStoredMode(accountId)),
	)

	// Re-read when account changes
	useEffect(() => {
		const stored = readStoredMode(accountId)
		setModeState(stored)
		const resolved = resolve(stored)
		setResolvedTheme(resolved)
		applyThemeClass(resolved)
	}, [accountId])

	// Apply the class whenever resolved theme changes
	useEffect(() => {
		applyThemeClass(resolvedTheme)
	}, [resolvedTheme])

	// Listen to system preference when mode is 'system'
	useEffect(() => {
		if (mode !== 'system') return

		const mq = window.matchMedia('(prefers-color-scheme: dark)')
		const handler = (e: MediaQueryListEvent) => {
			const next: ResolvedTheme = e.matches ? 'dark' : 'light'
			setResolvedTheme(next)
		}

		mq.addEventListener('change', handler)
		return () => mq.removeEventListener('change', handler)
	}, [mode])

	const setMode = useCallback((next: AppearanceMode) => {
		setModeState(next)
		const resolved = resolve(next)
		setResolvedTheme(resolved)
		localStorage.setItem(storageKey(accountId), next)
	}, [accountId])

	return { mode, setMode, resolvedTheme }
}

// ---------------------------------------------------------------------------
// Bootstrap: apply theme class before React renders to avoid FOUC
// ---------------------------------------------------------------------------

/**
 * Call this synchronously as early as possible (before React renders) to
 * apply the correct theme class and avoid a flash of wrong theme.
 */
export function bootstrapTheme(): void {
	const mode = readStoredMode()
	const resolved = resolve(mode)
	applyThemeClass(resolved)
}
