"use client"

import { useMemo } from "react"
import { Check, ClipboardCopy, Loader2, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { MnemonicGridUi } from "./mnemonic-grid-ui"
import type {
  MnemonicFlowMode,
  MnemonicWordCount,
  VerificationChallenge,
} from "./use-mnemonic-flow"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Props for the mnemonic flow UI shell */
export interface MnemonicFlowUiProps {
  /** Operating mode */
  mode: MnemonicFlowMode
  /** Word list */
  words: string[]
  /** Expected word count */
  wordCount: MnemonicWordCount
  /** Whether the confirmation checkbox is checked */
  confirmed: boolean
  /** Toggle confirmation */
  onConfirmedChange: (value: boolean) => void
  /** Update a word at index */
  onWordChange: (index: number, value: string) => void
  /** Verification challenge (verify mode only) */
  challenge: VerificationChallenge | null
  /** Update a verification answer */
  onVerificationAnswer: (position: number, value: string) => void
  /** Whether the state is valid */
  isValid: boolean
  /** Whether submit is enabled */
  canSubmit: boolean
  /** Handle submit */
  onSubmit: () => void
  /** Handle cancel */
  onCancel: () => void
  /** Copy all words */
  onCopy: () => void
  /** Whether words were recently copied */
  copied: boolean
  /** External loading state */
  isLoading?: boolean
  /** Error message */
  error?: string | null
  /** Additional CSS classes */
  className?: string
}

// ---------------------------------------------------------------------------
// Mode config
// ---------------------------------------------------------------------------

interface ModeConfig {
  title: string
  description: string
  submitLabel: string
}

function getModeConfig(mode: MnemonicFlowMode, wordCount: MnemonicWordCount): ModeConfig {
  switch (mode) {
    case "display":
      return {
        title: "Recovery Phrase",
        description: `Your ${wordCount}-word recovery phrase. Store it securely.`,
        submitLabel: "Done",
      }
    case "create":
      return {
        title: "Create Recovery Phrase",
        description: `Write down these ${wordCount} words in order. You will need them to recover your wallet.`,
        submitLabel: "Continue",
      }
    case "import":
      return {
        title: "Import Recovery Phrase",
        description: `Enter your ${wordCount}-word recovery phrase to restore your wallet.`,
        submitLabel: "Import Wallet",
      }
    case "verify":
      return {
        title: "Verify Recovery Phrase",
        description:
          "Confirm you saved your recovery phrase by entering the words at the highlighted positions.",
        submitLabel: "Verify",
      }
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Full mnemonic flow UI with header, grid, confirmation, and action buttons.
 *
 * Pure presentation — all state and callbacks come through props. Pair with
 * `useMnemonicFlow` for the logic layer.
 */
export function MnemonicFlowUi({
  mode,
  words,
  wordCount,
  confirmed,
  onConfirmedChange,
  onWordChange,
  challenge,
  onVerificationAnswer,
  isValid,
  canSubmit,
  onSubmit,
  onCancel,
  onCopy,
  copied,
  isLoading = false,
  error,
  className,
}: MnemonicFlowUiProps) {
  const config = getModeConfig(mode, wordCount)

  // Build position sets for the grid
  const editablePositions = useMemo(() => {
    if (mode === "import") {
      return new Set(Array.from({ length: words.length }, (_, i) => i))
    }
    return undefined
  }, [mode, words.length])

  const blankPositions = useMemo(() => {
    if (mode === "verify" && challenge) {
      return new Set(challenge.positions)
    }
    return undefined
  }, [mode, challenge])

  return (
    <Card className={cn("w-full", className)}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex flex-col gap-1.5">
            <CardTitle>{config.title}</CardTitle>
            <CardDescription>{config.description}</CardDescription>
          </div>
          <Badge variant="outline" className="shrink-0">
            {wordCount} words
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        {/* Word grid */}
        <MnemonicGridUi
          words={words}
          columns={4}
          editablePositions={editablePositions}
          blankPositions={blankPositions}
          onWordChange={onWordChange}
          blankValues={challenge?.answers}
          onBlankChange={onVerificationAnswer}
        />

        {/* Copy button for display and create modes */}
        {(mode === "display" || mode === "create") && (
          <Button
            variant="outline"
            size="sm"
            className="self-end"
            onClick={onCopy}
            aria-label="Copy recovery phrase"
          >
            {copied ? (
              <>
                <Check data-icon="inline-start" />
                Copied
              </>
            ) : (
              <>
                <ClipboardCopy data-icon="inline-start" />
                Copy All
              </>
            )}
          </Button>
        )}

        {/* Confirmation checkbox for create mode */}
        {mode === "create" && (
          <div className="flex items-center gap-2 rounded-md border border-border bg-muted/50 px-4 py-3">
            <Checkbox
              id="mnemonic-confirm"
              checked={confirmed}
              onCheckedChange={(checked) =>
                onConfirmedChange(checked === true)
              }
            />
            <Label
              htmlFor="mnemonic-confirm"
              className="cursor-pointer select-none text-sm"
            >
              I have written down my recovery phrase
            </Label>
          </div>
        )}

        {/* Verification hint */}
        {mode === "verify" && challenge && (
          <p className="text-sm text-muted-foreground">
            Enter word{" "}
            <span className="font-mono font-medium text-foreground">
              #{challenge.positions[0] + 1}
            </span>{" "}
            and{" "}
            <span className="font-mono font-medium text-foreground">
              #{challenge.positions[1] + 1}
            </span>{" "}
            from your recovery phrase.
          </p>
        )}

        {/* Error message */}
        {error && (
          <div className="flex items-start gap-3 rounded-md border border-destructive/20 bg-destructive/5 p-4">
            <X className="mt-0.5 size-4 shrink-0 text-destructive" />
            <p className="text-sm text-destructive">{error}</p>
          </div>
        )}
      </CardContent>

      {/* Footer with action buttons (hidden in pure display mode) */}
      {mode !== "display" && (
        <CardFooter className="flex gap-3">
          <Button variant="outline" className="flex-1" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            className="flex-1"
            onClick={onSubmit}
            disabled={!canSubmit || isLoading}
            aria-busy={isLoading}
          >
            {isLoading ? (
              <>
                <Loader2 className="animate-spin" data-icon="inline-start" />
                Processing...
              </>
            ) : (
              config.submitLabel
            )}
          </Button>
        </CardFooter>
      )}
    </Card>
  )
}
