"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  Coins,
  Loader2,
  Send,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { cn } from "@/lib/utils"
import type { SendBsv21Params, SendBsv21Result, TokenBalance } from "./use-send-bsv21"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SendBsv21UiProps {
  /** Available token balances for the selector */
  balances: TokenBalance[]
  /** Whether a send is in progress */
  isLoading: boolean
  /** Current error state */
  error: Error | null
  /** Result of the last send */
  result: SendBsv21Result | null
  /** Called when the user submits the send form */
  onSubmit: (params: SendBsv21Params) => Promise<SendBsv21Result>
  /** Reset hook state */
  onReset: () => void
  /** Optional CSS class */
  className?: string
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BSV_ADDRESS_RE = /^[13][1-9A-HJ-NP-Za-km-z]{24,33}$/

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isValidBsvAddress(address: string): boolean {
  return BSV_ADDRESS_RE.test(address.trim())
}

/**
 * Format a raw token amount string using the token's decimal places.
 * e.g. "1500" with decimals=2 becomes "15".
 */
function formatTokenAmount(raw: string, decimals: number): string {
  if (decimals === 0) return raw
  const padded = raw.padStart(decimals + 1, "0")
  const intPart = padded.slice(0, padded.length - decimals)
  const decPart = padded.slice(padded.length - decimals)
  const trimmedDec = decPart.replace(/0+$/, "")
  return trimmedDec ? `${intPart}.${trimmedDec}` : intPart
}

/**
 * Parse a human-readable amount string (e.g. "10.5") into a raw integer string
 * given the token's decimal places.
 */
function parseAmountToRaw(input: string, decimals: number): string | null {
  if (!input || input === ".") return null

  const parts = input.split(".")
  if (parts.length > 2) return null

  const intPart = parts[0] || "0"
  const decPart = (parts[1] || "").padEnd(decimals, "0").slice(0, decimals)
  const raw = intPart + decPart

  // Strip leading zeros but keep at least "0"
  const stripped = raw.replace(/^0+/, "") || "0"
  return stripped
}

/**
 * Compare two numeric strings as BigInt values.
 * Returns negative if a < b, zero if equal, positive if a > b.
 */
function compareBigIntStrings(a: string, b: string): number {
  const bigA = BigInt(a)
  const bigB = BigInt(b)
  if (bigA < bigB) return -1
  if (bigA > bigB) return 1
  return 0
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SendBsv21Ui({
  balances,
  isLoading,
  error,
  result,
  onSubmit,
  onReset,
  className,
}: SendBsv21UiProps) {
  const [selectedTokenId, setSelectedTokenId] = useState("")
  const [amountInput, setAmountInput] = useState("")
  const [address, setAddress] = useState("")
  const [dropdownOpen, setDropdownOpen] = useState(false)

  // Auto-select first token if none selected
  useEffect(() => {
    if (!selectedTokenId && balances.length > 0) {
      setSelectedTokenId(balances[0].tokenId)
    }
  }, [balances, selectedTokenId])

  const selectedToken = useMemo(
    () => balances.find((b) => b.tokenId === selectedTokenId),
    [balances, selectedTokenId],
  )

  const formattedBalance = useMemo(() => {
    if (!selectedToken) return "0"
    return formatTokenAmount(selectedToken.balance, selectedToken.decimals)
  }, [selectedToken])

  // Validation
  const validationError = useMemo(() => {
    if (!amountInput && !address) return null

    if (address && address.trim().length > 0 && !isValidBsvAddress(address)) {
      return "Invalid BSV address"
    }

    if (amountInput && selectedToken) {
      const raw = parseAmountToRaw(amountInput, selectedToken.decimals)
      if (raw === null || raw === "0") {
        return "Amount must be greater than zero"
      }
      if (compareBigIntStrings(raw, selectedToken.balance) > 0) {
        return `Insufficient balance (${formattedBalance} ${selectedToken.symbol} available)`
      }
    }

    return null
  }, [amountInput, address, selectedToken, formattedBalance])

  const canSend = useMemo(() => {
    if (!selectedToken || !amountInput || !address) return false
    if (!isValidBsvAddress(address)) return false
    const raw = parseAmountToRaw(amountInput, selectedToken.decimals)
    if (raw === null || raw === "0") return false
    if (compareBigIntStrings(raw, selectedToken.balance) > 0) return false
    return true
  }, [selectedToken, amountInput, address])

  const handleAmountChange = useCallback(
    (value: string) => {
      const decimals = selectedToken?.decimals ?? 0
      if (decimals === 0) {
        // Integer only
        setAmountInput(value.replace(/[^0-9]/g, ""))
      } else {
        // Allow digits and single decimal point, limit decimal places
        const cleaned = value
          .replace(/[^0-9.]/g, "")
          .replace(/(\..*)\./g, "$1")

        const parts = cleaned.split(".")
        if (parts.length === 2 && parts[1].length > decimals) {
          setAmountInput(`${parts[0]}.${parts[1].slice(0, decimals)}`)
        } else {
          setAmountInput(cleaned)
        }
      }
    },
    [selectedToken],
  )

  const handleMaxClick = useCallback(() => {
    if (selectedToken) {
      setAmountInput(formattedBalance)
    }
  }, [selectedToken, formattedBalance])

  const handleSelectToken = useCallback((tokenId: string) => {
    setSelectedTokenId(tokenId)
    setAmountInput("")
    setDropdownOpen(false)
  }, [])

  const handleSend = useCallback(async () => {
    if (!canSend || !selectedToken) return

    const raw = parseAmountToRaw(amountInput, selectedToken.decimals)
    if (!raw) return

    await onSubmit({
      tokenId: selectedToken.tokenId,
      amount: raw,
      address: address.trim(),
    })
  }, [canSend, selectedToken, amountInput, address, onSubmit])

  const handleNewTransfer = useCallback(() => {
    setAmountInput("")
    setAddress("")
    onReset()
  }, [onReset])

  return (
    <Card className={cn("w-full max-w-md", className)}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Coins className="size-5" aria-hidden="true" />
          Send Tokens
        </CardTitle>
        <CardDescription>
          Transfer BSV21 tokens to any address
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        {/* Token selector */}
        <div className="flex flex-col gap-2">
          <Label htmlFor="send-bsv21-token">Token</Label>
          <div className="relative">
            <button
              id="send-bsv21-token"
              type="button"
              className={cn(
                "flex w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                "disabled:cursor-not-allowed disabled:opacity-50",
                "transition-colors duration-150",
              )}
              onClick={() => setDropdownOpen((prev) => !prev)}
              disabled={isLoading || !!result?.txid || balances.length === 0}
              aria-expanded={dropdownOpen}
              aria-haspopup="listbox"
            >
              {selectedToken ? (
                <span className="flex items-center gap-2 truncate">
                  {selectedToken.iconUrl ? (
                    <img
                      src={selectedToken.iconUrl}
                      alt=""
                      className="size-5 rounded-full object-cover"
                    />
                  ) : (
                    <span className="flex size-5 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground">
                      {selectedToken.symbol.charAt(0).toUpperCase()}
                    </span>
                  )}
                  <span className="font-medium">{selectedToken.symbol}</span>
                  <span className="text-muted-foreground">
                    {formattedBalance}
                  </span>
                </span>
              ) : (
                <span className="text-muted-foreground">Select a token</span>
              )}
              <ChevronDown
                className={cn(
                  "size-4 text-muted-foreground transition-transform duration-150",
                  dropdownOpen && "rotate-180",
                )}
                aria-hidden="true"
              />
            </button>

            {dropdownOpen && balances.length > 0 && (
              <div
                className="absolute z-50 mt-1 w-full rounded-md border bg-popover p-1 shadow-md"
                role="listbox"
                aria-label="Token list"
              >
                {balances.map((token) => (
                  <button
                    key={token.tokenId}
                    type="button"
                    role="option"
                    aria-selected={token.tokenId === selectedTokenId}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm",
                      "hover:bg-accent hover:text-accent-foreground",
                      "transition-colors duration-100",
                      token.tokenId === selectedTokenId && "bg-accent/50",
                    )}
                    onClick={() => handleSelectToken(token.tokenId)}
                  >
                    {token.iconUrl ? (
                      <img
                        src={token.iconUrl}
                        alt=""
                        className="size-5 rounded-full object-cover"
                      />
                    ) : (
                      <span className="flex size-5 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground">
                        {token.symbol.charAt(0).toUpperCase()}
                      </span>
                    )}
                    <span className="font-medium">{token.symbol}</span>
                    <span className="ml-auto text-muted-foreground">
                      {formatTokenAmount(token.balance, token.decimals)}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Amount input */}
        <div className="flex flex-col gap-2">
          <Label htmlFor="send-bsv21-amount">Amount</Label>
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Input
                id="send-bsv21-amount"
                type="text"
                inputMode="decimal"
                placeholder="0.00"
                value={amountInput}
                onChange={(e) => handleAmountChange(e.target.value)}
                disabled={isLoading || !!result?.txid || !selectedToken}
                className="pr-16"
                aria-describedby="send-bsv21-amount-hint"
                autoComplete="off"
                spellCheck={false}
              />
              {selectedToken && (
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs font-medium text-muted-foreground">
                  {selectedToken.symbol}
                </span>
              )}
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="flex-shrink-0 text-xs"
              onClick={handleMaxClick}
              disabled={isLoading || !!result?.txid || !selectedToken}
            >
              Max
            </Button>
          </div>
          {selectedToken && amountInput && (
            <p
              id="send-bsv21-amount-hint"
              className="text-xs text-muted-foreground"
            >
              Balance: {formattedBalance} {selectedToken.symbol}
            </p>
          )}
        </div>

        {/* Recipient address */}
        <div className="flex flex-col gap-2">
          <Label htmlFor="send-bsv21-address">Recipient Address</Label>
          <Input
            id="send-bsv21-address"
            type="text"
            placeholder="1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            disabled={isLoading || !!result?.txid}
            className="font-mono text-sm"
            autoComplete="off"
            spellCheck={false}
          />
        </div>

        {/* Validation error */}
        {validationError && (
          <p className="text-sm text-destructive" role="alert">
            {validationError}
          </p>
        )}

        {/* Summary */}
        {canSend && !result?.txid && (
          <>
            <Separator />
            <div className="flex items-center justify-between rounded-md border bg-muted/50 px-4 py-3">
              <div className="flex flex-col gap-0.5">
                <p className="text-sm text-muted-foreground">Sending</p>
                <p className="text-sm font-medium">
                  {amountInput} {selectedToken?.symbol}
                </p>
              </div>
              <Badge variant="secondary" className="font-mono text-xs">
                {address.slice(0, 6)}...{address.slice(-4)}
              </Badge>
            </div>
          </>
        )}

        {/* Success */}
        {result?.txid && (
          <div className="flex items-start gap-3 rounded-md border border-primary/20 bg-primary/5 p-3">
            <CheckCircle2 className="mt-0.5 size-4 flex-shrink-0 text-primary" />
            <div className="min-w-0 flex flex-col gap-1">
              <p className="text-sm font-medium">Tokens sent successfully</p>
              <Badge
                variant="outline"
                className="max-w-full truncate font-mono text-xs"
              >
                {result.txid}
              </Badge>
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="flex items-start gap-3 rounded-md border border-destructive/20 bg-destructive/5 p-3">
            <AlertCircle className="mt-0.5 size-4 flex-shrink-0 text-destructive" />
            <div className="flex flex-col gap-1">
              <p className="text-sm font-medium">Send failed</p>
              <p className="text-xs text-muted-foreground">{error.message}</p>
            </div>
          </div>
        )}
      </CardContent>

      <CardFooter>
        {result?.txid ? (
          <Button className="w-full" variant="outline" onClick={handleNewTransfer}>
            Send Another
          </Button>
        ) : (
          <Button
            className="w-full"
            onClick={handleSend}
            disabled={!canSend || isLoading}
            aria-busy={isLoading}
          >
            {isLoading ? (
              <>
                <Loader2
                  className="animate-spin"
                  data-icon="inline-start"
                  aria-hidden="true"
                />
                Sending...
              </>
            ) : (
              <>
                <Send data-icon="inline-start" aria-hidden="true" />
                Send Tokens
              </>
            )}
          </Button>
        )}
      </CardFooter>
    </Card>
  )
}
