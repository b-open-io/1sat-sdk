import { useCallback, useMemo, useState } from "react"
import type { DeployTokenFormState } from "./ui"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Parameters passed to the onDeploy callback */
export interface DeployTokenParams {
  /** Token symbol */
  symbol: string
  /** Maximum supply as a string (raw integer, no separators) */
  maxSupply: string
  /** Decimal precision (0-18) */
  decimals: number
  /** Base64-encoded icon image content */
  iconBase64: string
  /** MIME type of the icon image */
  iconContentType: string
}

/** Result returned from the deploy callback */
export interface DeployTokenResult {
  /** Transaction ID of the deploy inscription */
  txid?: string
  /** Raw transaction hex */
  rawtx?: string
  /** Error message if deployment failed */
  error?: string
}

export interface UseDeployTokenOptions {
  /** Default symbol value */
  defaultSymbol?: string
  /** Default max supply value */
  defaultMaxSupply?: string
  /** Default decimal precision */
  defaultDecimals?: number
}

export interface UseDeployTokenReturn {
  /** Current form state for the UI */
  form: DeployTokenFormState
  /** Whether the form is valid for submission */
  isValid: boolean
  /** Whether a deploy is in progress */
  isDeploying: boolean
  /** Estimated fee in satoshis */
  feeEstimate: number
  /** Deploy result txid */
  resultTxid: string | null
  /** Error message */
  errorMessage: string | null
  /** Update the symbol */
  setSymbol: (value: string) => void
  /** Update max supply */
  setMaxSupply: (value: string) => void
  /** Update decimals */
  setDecimals: (value: string) => void
  /** Select an icon file */
  selectIcon: (file: File) => void
  /** Remove the icon */
  removeIcon: () => void
  /** Execute the deploy action */
  deploy: (
    handler: (params: DeployTokenParams) => Promise<DeployTokenResult>
  ) => Promise<void>
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result
      if (typeof result !== "string") {
        reject(new Error("Failed to read file"))
        return
      }
      const base64 = result.split(",")[1]
      if (!base64) {
        reject(new Error("Failed to encode file as base64"))
        return
      }
      resolve(base64)
    }
    reader.onerror = () => reject(new Error("Failed to read file"))
    reader.readAsDataURL(file)
  })
}

/**
 * Estimate the deploy fee.
 *
 * A BSV21 deploy+mint inscription includes the JSON payload plus
 * the icon image data. The estimate accounts for the base transaction
 * overhead plus ~0.5 sat per byte of icon data.
 */
function estimateDeployFee(iconSize: number): number {
  const baseFee = 100 // base tx overhead for deploy inscription
  const iconFee = Math.ceil(iconSize * 0.5)
  return baseFee + iconFee
}

function parseDecimals(value: string): number {
  if (value === "") return 8
  const parsed = Number.parseInt(value, 10)
  if (Number.isNaN(parsed)) return 8
  return Math.max(0, Math.min(18, parsed))
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Manages form state, validation, icon handling, fee estimation, and deploy
 * execution for a BSV21 token deployment.
 *
 * The hook is pure logic with no UI. Pair it with `DeployTokenUI` for
 * the presentation layer.
 *
 * @example
 * ```ts
 * const token = useDeployToken({ defaultMaxSupply: "21000000" })
 *
 * // In the deploy handler:
 * token.deploy(async (params) => {
 *   const config: DeployBsv21TokenConfig = {
 *     symbol: params.symbol,
 *     decimals: params.decimals,
 *     icon: { dataB64: params.iconBase64, contentType: params.iconContentType },
 *     initialDistribution: { address: myAddress, tokens: Number(params.maxSupply) },
 *     destinationAddress: myAddress,
 *     utxos: paymentUtxos,
 *   }
 *   const tx = await deployBsv21Token(config)
 *   return { txid: tx.id("hex") }
 * })
 * ```
 */
export function useDeployToken(
  options: UseDeployTokenOptions = {}
): UseDeployTokenReturn {
  const {
    defaultSymbol = "",
    defaultMaxSupply = "21000000",
    defaultDecimals = 8,
  } = options

  // Form fields
  const [symbol, setSymbol] = useState(defaultSymbol)
  const [maxSupply, setMaxSupply] = useState(defaultMaxSupply)
  const [decimals, setDecimals] = useState(
    defaultDecimals === 8 ? "" : String(defaultDecimals)
  )
  const [iconFile, setIconFile] = useState<File | null>(null)
  const [iconPreviewUrl, setIconPreviewUrl] = useState<string | null>(null)

  // Execution state
  const [isDeploying, setIsDeploying] = useState(false)
  const [resultTxid, setResultTxid] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  // Derived state
  const isValid = useMemo(() => {
    if (!symbol.trim()) return false
    if (!iconFile) return false
    if (!maxSupply || maxSupply === "0") return false
    const dec = parseDecimals(decimals)
    if (dec < 0 || dec > 18) return false
    return true
  }, [symbol, iconFile, maxSupply, decimals])

  const feeEstimate = useMemo(() => {
    if (!iconFile) return 0
    return estimateDeployFee(iconFile.size)
  }, [iconFile])

  const form: DeployTokenFormState = useMemo(
    () => ({
      symbol,
      maxSupply,
      decimals,
      iconFile,
      iconPreviewUrl,
    }),
    [symbol, maxSupply, decimals, iconFile, iconPreviewUrl]
  )

  // Icon handlers
  const selectIcon = useCallback(
    (file: File) => {
      if (iconPreviewUrl) {
        URL.revokeObjectURL(iconPreviewUrl)
      }
      setIconFile(file)
      setIconPreviewUrl(URL.createObjectURL(file))
      setResultTxid(null)
      setErrorMessage(null)
    },
    [iconPreviewUrl]
  )

  const removeIcon = useCallback(() => {
    if (iconPreviewUrl) {
      URL.revokeObjectURL(iconPreviewUrl)
    }
    setIconFile(null)
    setIconPreviewUrl(null)
  }, [iconPreviewUrl])

  // Deploy execution
  const deploy = useCallback(
    async (
      handler: (params: DeployTokenParams) => Promise<DeployTokenResult>
    ) => {
      if (!isValid || !iconFile) return

      setIsDeploying(true)
      setErrorMessage(null)
      setResultTxid(null)

      try {
        const iconBase64 = await fileToBase64(iconFile)
        const params: DeployTokenParams = {
          symbol: symbol.trim(),
          maxSupply,
          decimals: parseDecimals(decimals),
          iconBase64,
          iconContentType: iconFile.type || "image/png",
        }

        const result = await handler(params)

        if (result.error) {
          setErrorMessage(result.error)
        } else if (result.txid) {
          setResultTxid(result.txid)
        }
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Token deployment failed"
        setErrorMessage(message)
      } finally {
        setIsDeploying(false)
      }
    },
    [isValid, iconFile, symbol, maxSupply, decimals]
  )

  return {
    form,
    isValid,
    isDeploying,
    feeEstimate,
    resultTxid,
    errorMessage,
    setSymbol,
    setMaxSupply,
    setDecimals,
    selectIcon,
    removeIcon,
    deploy,
  }
}
