"use client"

import { useCallback, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Bsv20Mode = "mint" | "deploy"

export interface Bsv20FormData {
  /** Whether minting an existing ticker or deploying a new one */
  mode: Bsv20Mode
  /** Ticker symbol (max 4 chars, uppercase) */
  ticker: string
  /** Amount to mint (mint mode only) */
  amount: string
  /** Max supply (deploy mode only) */
  maxSupply: string
  /** Mint limit per transaction (deploy mode only) */
  mintLimit: string
  /** Decimal precision (deploy mode only) */
  decimals: string
}

export interface Bsv20FormProps {
  /** Current form data */
  data: Bsv20FormData
  /** Callback when any field changes */
  onDataChange: (data: Bsv20FormData) => void
  /** Optional CSS class name */
  className?: string
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createDefaultBsv20Data(): Bsv20FormData {
  return {
    mode: "mint",
    ticker: "",
    amount: "",
    maxSupply: "21000000",
    mintLimit: "1000",
    decimals: "0",
  }
}

export { createDefaultBsv20Data }

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Form for BSV20 fungible token inscription — supports both minting existing
 * tickers and deploying new ones.
 */
export function Bsv20Form({ data, onDataChange, className }: Bsv20FormProps) {
  const updateField = useCallback(
    <K extends keyof Bsv20FormData>(field: K, value: Bsv20FormData[K]) => {
      onDataChange({ ...data, [field]: value })
    },
    [data, onDataChange]
  )

  return (
    <div className={cn("flex flex-col gap-4", className)}>
      {/* Mode toggle */}
      <div className="flex items-center justify-between">
        <Label>Mode</Label>
        <div className="flex rounded-lg border bg-muted p-1">
          <Button
            type="button"
            variant={data.mode === "mint" ? "secondary" : "ghost"}
            size="sm"
            onClick={() => updateField("mode", "mint")}
            className="h-7 text-xs"
          >
            Mint
          </Button>
          <Button
            type="button"
            variant={data.mode === "deploy" ? "secondary" : "ghost"}
            size="sm"
            onClick={() => updateField("mode", "deploy")}
            className="h-7 text-xs"
          >
            Deploy
          </Button>
        </div>
      </div>

      <p className="text-sm text-muted-foreground">
        {data.mode === "mint"
          ? "Mint tokens from an existing BSV20 ticker."
          : "Deploy a new BSV20 ticker to the blockchain."}
      </p>

      {/* Ticker */}
      <div className="grid gap-2">
        <Label htmlFor="bsv20-ticker">Ticker</Label>
        <Input
          id="bsv20-ticker"
          placeholder="e.g. PEPE"
          value={data.ticker}
          onChange={(e) =>
            updateField(
              "ticker",
              e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4)
            )
          }
          maxLength={4}
          aria-describedby="bsv20-ticker-hint"
        />
        <p id="bsv20-ticker-hint" className="text-xs text-muted-foreground">
          Up to 4 uppercase characters.
        </p>
      </div>

      {data.mode === "mint" ? (
        /* Mint fields */
        <div className="grid gap-2">
          <Label htmlFor="bsv20-amount">Amount</Label>
          <Input
            id="bsv20-amount"
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            placeholder="1000"
            value={data.amount}
            onChange={(e) =>
              updateField("amount", e.target.value.replace(/[^0-9]/g, ""))
            }
          />
        </div>
      ) : (
        /* Deploy fields */
        <>
          <div className="grid gap-2">
            <Label htmlFor="bsv20-max">Max Supply</Label>
            <Input
              id="bsv20-max"
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              placeholder="21000000"
              value={data.maxSupply}
              onChange={(e) =>
                updateField("maxSupply", e.target.value.replace(/[^0-9]/g, ""))
              }
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="bsv20-limit">Mint Limit</Label>
            <Input
              id="bsv20-limit"
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              placeholder="1000"
              value={data.mintLimit}
              onChange={(e) =>
                updateField("mintLimit", e.target.value.replace(/[^0-9]/g, ""))
              }
            />
            <p className="text-xs text-muted-foreground">
              Max tokens per mint transaction.
            </p>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="bsv20-decimals">Decimals</Label>
            <Input
              id="bsv20-decimals"
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              placeholder="0"
              value={data.decimals}
              onChange={(e) =>
                updateField("decimals", e.target.value.replace(/[^0-9]/g, ""))
              }
            />
          </div>
        </>
      )}
    </div>
  )
}
