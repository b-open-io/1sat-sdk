import { createContext, useContext } from 'react'
import { ThemeTokenSettingsUi } from './theme-token-settings-ui'
import {
	type UseThemeTokenOptions,
	type UseThemeTokenReturn,
	useThemeToken,
} from './use-theme-token'

// ---------------------------------------------------------------------------
// Re-exports
// ---------------------------------------------------------------------------

export { useThemeToken } from './use-theme-token'
export type {
	UseThemeTokenOptions,
	UseThemeTokenReturn,
	ThemeTokenStatus,
} from './use-theme-token'
export { ThemeTokenSettingsUi } from './theme-token-settings-ui'
export type { ThemeTokenSettingsUiProps } from './theme-token-settings-ui'

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const ThemeTokenContext = createContext<UseThemeTokenReturn | null>(null)

/**
 * Access the ThemeToken context provided by `ThemeTokenProvider`.
 *
 * @throws If called outside of a `ThemeTokenProvider`.
 *
 * @example
 * ```tsx
 * const { origin, setOrigin, clearOrigin, isLoading } = useThemeTokenContext()
 * ```
 */
export function useThemeTokenContext(): UseThemeTokenReturn {
	const ctx = useContext(ThemeTokenContext)
	if (!ctx) {
		throw new Error(
			'useThemeTokenContext must be used within a <ThemeTokenProvider>',
		)
	}
	return ctx
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

/** Props for the ThemeTokenProvider component */
export interface ThemeTokenProviderProps extends UseThemeTokenOptions {
	/** Child elements to wrap */
	children?: React.ReactNode
	/** Additional CSS classes on the wrapper div */
	className?: string
}

/**
 * Provides on-chain theme state to the component tree.
 *
 * On mount, reads the saved origin from localStorage (or uses `defaultOrigin`),
 * fetches the ThemeToken from the blockchain, and applies its CSS variables to
 * the document root. All children can access the theme state via
 * `useThemeTokenContext()`.
 *
 * @example
 * ```tsx
 * <ThemeTokenProvider defaultOrigin="abc123_0">
 *   <App />
 * </ThemeTokenProvider>
 * ```
 */
export function ThemeTokenProvider({
	children,
	className,
	defaultOrigin,
	storageKey,
	resolvedTheme,
	onThemeApplied,
	onThemeCleared,
	onError,
}: ThemeTokenProviderProps) {
	const themeToken = useThemeToken({
		defaultOrigin,
		storageKey,
		resolvedTheme,
		onThemeApplied,
		onThemeCleared,
		onError,
	})

	return (
		<ThemeTokenContext.Provider value={themeToken}>
			<div className={className}>{children}</div>
		</ThemeTokenContext.Provider>
	)
}

// ---------------------------------------------------------------------------
// Settings (composed)
// ---------------------------------------------------------------------------

/** Props for the composed ThemeTokenSettings component */
export interface ThemeTokenSettingsProps {
	/** Callback fired after a theme is applied */
	onApply?: (origin: string) => void
	/** Callback fired when the theme is cleared */
	onClear?: () => void
	/** Additional CSS classes */
	className?: string
}

/**
 * Settings panel that reads from `ThemeTokenProvider` context.
 *
 * Must be rendered inside a `<ThemeTokenProvider>`. Wires the
 * `ThemeTokenSettingsUi` to the context's state and actions.
 *
 * @example
 * ```tsx
 * <ThemeTokenProvider>
 *   <ThemeTokenSettings />
 * </ThemeTokenProvider>
 * ```
 */
export function ThemeTokenSettings({
	onApply,
	onClear,
	className,
}: ThemeTokenSettingsProps) {
	const { origin, theme, status, error, setOrigin, clearOrigin } =
		useThemeTokenContext()

	const handleApply = async (newOrigin: string) => {
		await setOrigin(newOrigin)
		onApply?.(newOrigin)
	}

	const handleClear = () => {
		clearOrigin()
		onClear?.()
	}

	return (
		<ThemeTokenSettingsUi
			origin={origin}
			themeName={theme?.name ?? null}
			status={status}
			errorMessage={error?.message ?? null}
			onApply={handleApply}
			onClear={handleClear}
			className={className}
		/>
	)
}
