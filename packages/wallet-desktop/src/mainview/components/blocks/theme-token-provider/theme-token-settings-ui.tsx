"use client"

import { useCallback, useState } from "react"
import { Loader2, Palette, RotateCcw, Check, AlertCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { cn } from "@/lib/utils"
import type { ThemeTokenStatus } from "./use-theme-token"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Color swatch entry for the preview grid */
interface ColorSwatch {
  /** Display label */
  label: string
  /** CSS variable name (e.g. "primary") */
  variable: string
}

/** Props for the settings panel UI */
export interface ThemeTokenSettingsUiProps {
  /** Currently active theme origin, or null */
  origin: string | null
  /** Theme name from the fetched ThemeToken */
  themeName: string | null
  /** Current lifecycle status */
  status: ThemeTokenStatus
  /** Error message if status is "error" */
  errorMessage: string | null
  /** Callback to apply a theme by origin */
  onApply: (origin: string) => void
  /** Callback to clear the active theme */
  onClear: () => void
  /** Additional CSS classes */
  className?: string
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const COLOR_SWATCHES: ColorSwatch[] = [
  { label: "Primary", variable: "primary" },
  { label: "Secondary", variable: "secondary" },
  { label: "Accent", variable: "accent" },
  { label: "Muted", variable: "muted" },
  { label: "Destructive", variable: "destructive" },
  { label: "Background", variable: "background" },
  { label: "Card", variable: "card" },
  { label: "Border", variable: "border" },
]

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Settings panel for selecting and applying on-chain themes.
 *
 * Displays an origin input, apply/reset buttons, the current theme status,
 * and a preview grid of the active color swatches read from CSS variables.
 */
export function ThemeTokenSettingsUi({
  origin,
  themeName,
  status,
  errorMessage,
  onApply,
  onClear,
  className,
}: ThemeTokenSettingsUiProps) {
  const [inputValue, setInputValue] = useState(origin ?? "")

  const handleApply = useCallback(() => {
    const trimmed = inputValue.trim()
    if (trimmed.length === 0) return
    onApply(trimmed)
  }, [inputValue, onApply])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        handleApply()
      }
    },
    [handleApply],
  )

  const isLoading = status === "loading"
  const isApplied = status === "applied"
  const isError = status === "error"

  return (
    <Card className={cn("w-full max-w-md", className)}>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Palette className="size-5 text-muted-foreground" aria-hidden="true" />
          <CardTitle>Theme Token</CardTitle>
        </div>
        <CardDescription>
          Apply an on-chain theme by entering its origin (txid_vout format).
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        {/* Origin input */}
        <div className="flex flex-col gap-2">
          <Label htmlFor="theme-origin">Origin</Label>
          <Input
            id="theme-origin"
            placeholder="e.g. abc123def456…_0"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isLoading}
            aria-describedby="theme-origin-hint"
          />
          <p id="theme-origin-hint" className="text-xs text-muted-foreground">
            The origin outpoint of an inscribed ThemeToken.
          </p>
        </div>

        {/* Status badge */}
        {status !== "idle" && (
          <div className="flex items-center gap-2">
            {isLoading && (
              <Badge variant="secondary" className="gap-1.5">
                <Loader2
                  className="size-3 animate-spin"
                  aria-hidden="true"
                  data-icon="inline-start"
                />
                Loading theme...
              </Badge>
            )}
            {isApplied && (
              <Badge variant="default" className="gap-1.5">
                <Check
                  className="size-3"
                  aria-hidden="true"
                  data-icon="inline-start"
                />
                {themeName ?? "Theme applied"}
              </Badge>
            )}
            {isError && (
              <Badge variant="destructive" className="gap-1.5">
                <AlertCircle
                  className="size-3"
                  aria-hidden="true"
                  data-icon="inline-start"
                />
                {errorMessage ?? "Error"}
              </Badge>
            )}
          </div>
        )}

        {/* Color swatches preview */}
        {isApplied && (
          <>
            <Separator />
            <div className="flex flex-col gap-2">
              <p className="text-sm font-medium text-foreground">
                Active Colors
              </p>
              <div className="grid grid-cols-4 gap-2">
                {COLOR_SWATCHES.map((swatch) => (
                  <div
                    key={swatch.variable}
                    className="flex flex-col items-center gap-1"
                  >
                    <div
                      className="size-8 rounded-md border border-border"
                      style={{
                        backgroundColor: `var(--${swatch.variable})`,
                      }}
                      aria-label={`${swatch.label} color swatch`}
                    />
                    <span className="text-[10px] leading-tight text-muted-foreground">
                      {swatch.label}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </CardContent>

      <CardFooter className="flex gap-2">
        <Button
          onClick={handleApply}
          disabled={isLoading || inputValue.trim().length === 0}
          aria-busy={isLoading}
          className="gap-2"
        >
          {isLoading ? (
            <Loader2
              className="animate-spin"
              aria-hidden="true"
              data-icon="inline-start"
            />
          ) : (
            <Palette aria-hidden="true" data-icon="inline-start" />
          )}
          Apply Theme
        </Button>

        <Button
          variant="outline"
          onClick={onClear}
          disabled={isLoading || status === "idle"}
          className="gap-2"
        >
          <RotateCcw aria-hidden="true" data-icon="inline-start" />
          Reset to Default
        </Button>
      </CardFooter>
    </Card>
  )
}
