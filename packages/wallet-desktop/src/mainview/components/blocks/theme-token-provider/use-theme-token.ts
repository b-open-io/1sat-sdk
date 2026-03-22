import { useCallback, useEffect, useRef, useState } from "react"
import {
  fetchThemeByOrigin,
  applyThemeModeWithAssets,
  clearTheme,
  type ThemeToken,
  type PublishedTheme,
} from "@theme-token/sdk"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Status of the theme fetching/applying lifecycle */
export type ThemeTokenStatus = "idle" | "loading" | "applied" | "error"

/** Options for the useThemeToken hook */
export interface UseThemeTokenOptions {
  /** Default origin to load on mount (overridden by localStorage if set) */
  defaultOrigin?: string
  /** localStorage key for persisting the active origin */
  storageKey?: string
  /** Callback fired after a theme is successfully applied */
  onThemeApplied?: (origin: string) => void
  /** Callback fired when the theme is cleared */
  onThemeCleared?: () => void
  /** Callback fired when an error occurs */
  onError?: (error: Error) => void
}

/** Return value of the useThemeToken hook */
export interface UseThemeTokenReturn {
  /** Currently active theme origin, or null if none */
  origin: string | null
  /** The fetched ThemeToken data, or null */
  theme: ThemeToken | null
  /** Current lifecycle status */
  status: ThemeTokenStatus
  /** Error if status is "error" */
  error: Error | null
  /** Apply a theme by origin (fetches from chain, applies CSS vars, persists) */
  setOrigin: (origin: string) => Promise<void>
  /** Clear the active theme and revert to default CSS vars */
  clearOrigin: () => void
  /** Whether a theme operation is in progress */
  isLoading: boolean
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_STORAGE_KEY = "bigblocks-theme-origin"

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Manages on-chain theme loading, application, and localStorage persistence.
 *
 * Reads the saved origin from localStorage on mount, fetches the ThemeToken
 * from the blockchain via `@theme-token/sdk`, and applies its CSS variables
 * to the document root. Provides imperative methods to switch or clear themes.
 */
export function useThemeToken({
  defaultOrigin,
  storageKey = DEFAULT_STORAGE_KEY,
  onThemeApplied,
  onThemeCleared,
  onError,
}: UseThemeTokenOptions = {}): UseThemeTokenReturn {
  const [origin, setOriginState] = useState<string | null>(null)
  const [theme, setTheme] = useState<ThemeToken | null>(null)
  const [status, setStatus] = useState<ThemeTokenStatus>("idle")
  const [error, setError] = useState<Error | null>(null)

  // Stable refs for callbacks to avoid re-triggering effects
  const onThemeAppliedRef = useRef(onThemeApplied)
  onThemeAppliedRef.current = onThemeApplied
  const onThemeClearedRef = useRef(onThemeCleared)
  onThemeClearedRef.current = onThemeCleared
  const onErrorRef = useRef(onError)
  onErrorRef.current = onError

  // ------------------------------------------------------------------
  // Core: fetch + apply a theme by origin
  // ------------------------------------------------------------------

  const applyOrigin = useCallback(
    async (targetOrigin: string) => {
      setStatus("loading")
      setError(null)

      try {
        const published: PublishedTheme | null =
          await fetchThemeByOrigin(targetOrigin)

        if (!published) {
          throw new Error(
            `Theme not found for origin "${targetOrigin}". Verify the origin is a valid ThemeToken inscription.`,
          )
        }

        // Detect current color scheme
        const isDark =
          typeof document !== "undefined" &&
          document.documentElement.classList.contains("dark")
        const mode = isDark ? "dark" : "light"

        await applyThemeModeWithAssets(published.theme, mode)

        setOriginState(targetOrigin)
        setTheme(published.theme)
        setStatus("applied")

        // Persist
        if (typeof window !== "undefined") {
          localStorage.setItem(storageKey, targetOrigin)
        }

        onThemeAppliedRef.current?.(targetOrigin)
      } catch (err) {
        const e = err instanceof Error ? err : new Error(String(err))
        setError(e)
        setStatus("error")
        onErrorRef.current?.(e)
      }
    },
    [storageKey],
  )

  // ------------------------------------------------------------------
  // Public: set a new origin
  // ------------------------------------------------------------------

  const setOrigin = useCallback(
    async (newOrigin: string) => {
      await applyOrigin(newOrigin)
    },
    [applyOrigin],
  )

  // ------------------------------------------------------------------
  // Public: clear theme
  // ------------------------------------------------------------------

  const clearOrigin = useCallback(() => {
    clearTheme()
    setOriginState(null)
    setTheme(null)
    setStatus("idle")
    setError(null)

    if (typeof window !== "undefined") {
      localStorage.removeItem(storageKey)
    }

    onThemeClearedRef.current?.()
  }, [storageKey])

  // ------------------------------------------------------------------
  // Mount: restore persisted origin (or use default)
  // ------------------------------------------------------------------

  const mountedRef = useRef(false)

  useEffect(() => {
    if (mountedRef.current) return
    mountedRef.current = true

    if (typeof window === "undefined") return

    const saved = localStorage.getItem(storageKey)
    const initial = saved ?? defaultOrigin

    if (initial) {
      void applyOrigin(initial)
    }
  }, [storageKey, defaultOrigin, applyOrigin])

  return {
    origin,
    theme,
    status,
    error,
    setOrigin,
    clearOrigin,
    isLoading: status === "loading",
  }
}
