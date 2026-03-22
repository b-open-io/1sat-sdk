import { useCallback, useMemo, useState } from "react"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A funding UTXO found during scan */
export interface SweepFundingUtxo {
  /** Outpoint in txid_vout format */
  outpoint: string
  /** Satoshis held by this output */
  satoshis: number
}

/** An ordinal UTXO found during scan */
export interface SweepOrdinalUtxo {
  /** Outpoint in txid_vout format */
  outpoint: string
}

/** A group of BSV-21 token UTXOs */
export interface SweepTokenGroup {
  /** Token ID in txid_vout format */
  tokenId: string
  /** Human-readable symbol (e.g. "GOLD") */
  symbol?: string
  /** Total token amount as string (bigint serialization) */
  amount: string
}

/** Categorized assets discovered by scanning a WIF/address */
export interface ScanResult {
  /** Standard funding UTXOs */
  funding: SweepFundingUtxo[]
  /** 1Sat ordinal UTXOs */
  ordinals: SweepOrdinalUtxo[]
  /** BSV-21 token groups */
  tokens: SweepTokenGroup[]
  /** Total satoshis across all funding UTXOs */
  totalSats: number
}

/** Result from a sweep operation */
export interface SweepResult {
  /** Transaction ID on success */
  txid?: string
  /** Error message on failure */
  error?: string
}

/** Step in the sweep workflow */
export type SweepStep = "input" | "scanning" | "preview" | "sweeping" | "done" | "error"

/** Options for the useSweepWallet hook */
export interface UseSweepWalletOptions {
  /** Scan a WIF for spendable assets. Called with the raw WIF string. */
  onScan: (wif: string) => Promise<ScanResult>
  /** Execute the sweep transaction. Called with WIF and the scan result. */
  onSweep: (wif: string, assets: ScanResult) => Promise<SweepResult>
  /** Callback after a successful sweep */
  onSuccess?: (result: SweepResult) => void
  /** Callback on any error (scan or sweep) */
  onError?: (error: Error) => void
}

/** Return value of the useSweepWallet hook */
export interface UseSweepWalletReturn {
  /** Current step in the workflow */
  step: SweepStep
  /** Current WIF input value */
  wifInput: string
  /** Update the WIF input */
  setWifInput: (value: string) => void
  /** Whether the WIF input looks valid (base58check, 51-52 chars) */
  isWifValid: boolean
  /** Scanned assets (available after successful scan) */
  scanResult: ScanResult | null
  /** Sweep result (available after successful sweep) */
  sweepResult: SweepResult | null
  /** Current error message */
  error: string | null
  /** Whether any async operation is in flight */
  isLoading: boolean
  /** Initiate scanning */
  handleScan: () => Promise<void>
  /** Initiate sweeping */
  handleSweep: () => Promise<void>
  /** Reset back to input step */
  handleReset: () => void
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** WIF is base58check, typically 51 chars (uncompressed) or 52 chars (compressed) */
const WIF_PATTERN = /^[5KL][1-9A-HJ-NP-Za-km-z]{50,51}$/

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Manages the sweep-wallet workflow: WIF input -> scan -> preview -> sweep -> done.
 *
 * Pure logic hook. Does not import any UI or SDK packages. The caller provides
 * `onScan` and `onSweep` callbacks that wire into `@1sat/actions`.
 */
export function useSweepWallet({
  onScan,
  onSweep,
  onSuccess,
  onError,
}: UseSweepWalletOptions): UseSweepWalletReturn {
  const [step, setStep] = useState<SweepStep>("input")
  const [wifInput, setWifInput] = useState("")
  const [scanResult, setScanResult] = useState<ScanResult | null>(null)
  const [sweepResult, setSweepResult] = useState<SweepResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const isWifValid = useMemo(() => WIF_PATTERN.test(wifInput.trim()), [wifInput])

  const isLoading = step === "scanning" || step === "sweeping"

  const handleScan = useCallback(async () => {
    const trimmed = wifInput.trim()
    if (!WIF_PATTERN.test(trimmed)) return

    setStep("scanning")
    setError(null)
    setScanResult(null)
    setSweepResult(null)

    try {
      const result = await onScan(trimmed)
      setScanResult(result)

      const hasAssets =
        result.funding.length > 0 ||
        result.ordinals.length > 0 ||
        result.tokens.length > 0

      if (hasAssets) {
        setStep("preview")
      } else {
        setError("No assets found for this key")
        setStep("error")
      }
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err))
      setError(e.message)
      setStep("error")
      onError?.(e)
    }
  }, [wifInput, onScan, onError])

  const handleSweep = useCallback(async () => {
    if (!scanResult) return
    const trimmed = wifInput.trim()
    if (!WIF_PATTERN.test(trimmed)) return

    setStep("sweeping")
    setError(null)

    try {
      const result = await onSweep(trimmed, scanResult)

      if (result.error) {
        setError(result.error)
        setStep("error")
        onError?.(new Error(result.error))
      } else {
        setSweepResult(result)
        setStep("done")
        onSuccess?.(result)
      }
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err))
      setError(e.message)
      setStep("error")
      onError?.(e)
    }
  }, [wifInput, scanResult, onSweep, onSuccess, onError])

  const handleReset = useCallback(() => {
    setStep("input")
    setWifInput("")
    setScanResult(null)
    setSweepResult(null)
    setError(null)
  }, [])

  return {
    step,
    wifInput,
    setWifInput,
    isWifValid,
    scanResult,
    sweepResult,
    error,
    isLoading,
    handleScan,
    handleSweep,
    handleReset,
  }
}
