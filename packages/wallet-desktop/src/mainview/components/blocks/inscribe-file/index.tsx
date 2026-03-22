"use client"

import { useCallback, useMemo, useState } from "react"
import { AlertCircle, CheckCircle2, ExternalLink, Loader2 } from "lucide-react"
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
import { Separator } from "@/components/ui/separator"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { cn } from "@/lib/utils"
import { Bsv20Form, createDefaultBsv20Data, type Bsv20FormData } from "./bsv20-form"
import { Bsv21Form, createDefaultBsv21Data, type Bsv21FormData } from "./bsv21-form"
import { InscribeDropzone } from "./inscribe-dropzone"
import { InscribeForm, type MetadataEntry } from "./inscribe-form"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type InscribeTab = "file" | "bsv20" | "bsv21"

export interface InscribeFileProps {
  /** Callback with the inscribe action parameters when user clicks "Inscribe" */
  onInscribe: (params: InscribeParams) => Promise<InscribeResult>
  /** Callback on successful inscription */
  onSuccess?: (result: InscribeResult) => void
  /** Callback on error */
  onError?: (error: Error) => void
  /** Maximum file size in bytes (default: 10MB) */
  maxFileSize?: number
  /** Default tab to show */
  defaultTab?: InscribeTab
  /** Optional CSS class name */
  className?: string
}

export interface InscribeParams {
  /** The inscription type */
  type: InscribeTab
  /** Base64-encoded file content (file tab) */
  base64Content?: string
  /** MIME type of the file */
  contentType: string
  /** MAP metadata key/value pairs */
  map: Record<string, string>
  /** Whether to sign with BAP identity (Sigma) */
  signWithBAP?: boolean
  /** BSV20-specific data */
  bsv20?: Bsv20FormData
  /** BSV21-specific data */
  bsv21?: {
    symbol: string
    maxSupply: string
    decimals: string
    /** Base64-encoded icon content */
    iconBase64?: string
    /** Icon MIME type */
    iconContentType?: string
  }
}

export interface InscribeResult {
  /** Transaction ID of the inscription */
  txid?: string
  /** Raw transaction hex */
  rawtx?: string
  /** Error message if inscription failed */
  error?: string
}

// ---------------------------------------------------------------------------
// Re-exports for consumers
// ---------------------------------------------------------------------------

export type { MetadataEntry } from "./inscribe-form"
export type { Bsv20FormData, Bsv20Mode } from "./bsv20-form"
export type { Bsv21FormData } from "./bsv21-form"

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
      // Strip the data URL prefix to get raw base64
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

/** Estimate inscription fee (1 sat per byte of content + base tx fee) */
function estimateFee(fileSize: number): number {
  const baseFee = 50
  const perByteFee = Math.ceil(fileSize * 0.5)
  return baseFee + perByteFee
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * A complete inscription flow for uploading files, BSV20 tokens, and BSV21
 * tokens to the BSV blockchain.
 *
 * Includes a tabbed interface with:
 * - **File** tab: drag-and-drop file dropzone, content type override, BAP
 *   signing, MAP metadata editor, and fee estimate
 * - **BSV20** tab: mint existing tickers or deploy new ones
 * - **BSV21** tab: deploy new tokens with icon upload
 *
 * @example
 * ```tsx
 * <InscribeFile
 *   onInscribe={async (params) => {
 *     if (params.type === "file") {
 *       return await inscribe.execute(ctx, {
 *         base64Content: params.base64Content,
 *         contentType: params.contentType,
 *         map: params.map,
 *         signWithBAP: params.signWithBAP,
 *       })
 *     }
 *     // Handle bsv20/bsv21 params...
 *   }}
 *   onSuccess={(result) => console.log("txid:", result.txid)}
 * />
 * ```
 */
export function InscribeFile({
  onInscribe,
  onSuccess,
  onError,
  maxFileSize = 10 * 1024 * 1024,
  defaultTab = "file",
  className,
}: InscribeFileProps) {
  const [activeTab, setActiveTab] = useState<InscribeTab>(defaultTab)

  // File tab state
  const [file, setFile] = useState<File | null>(null)
  const [contentType, setContentType] = useState("application/octet-stream")
  const [signWithBAP, setSignWithBAP] = useState(false)
  const [metadata, setMetadata] = useState<MetadataEntry[]>([])

  // BSV20 tab state
  const [bsv20Data, setBsv20Data] = useState<Bsv20FormData>(
    createDefaultBsv20Data
  )

  // BSV21 tab state
  const [bsv21Data, setBsv21Data] = useState<Bsv21FormData>(
    createDefaultBsv21Data
  )

  // Shared state
  const [isInscribing, setIsInscribing] = useState(false)
  const [result, setResult] = useState<InscribeResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const feeEstimate = useMemo(() => {
    if (activeTab === "file" && file) return estimateFee(file.size)
    if (activeTab === "bsv20") return estimateFee(200)
    if (activeTab === "bsv21") {
      const iconSize = bsv21Data.icon?.size ?? 0
      return estimateFee(200 + iconSize)
    }
    return 0
  }, [activeTab, file, bsv21Data.icon])

  const canInscribe = useMemo(() => {
    if (activeTab === "file") return file !== null
    if (activeTab === "bsv20") return bsv20Data.ticker.length > 0
    if (activeTab === "bsv21") {
      return (
        bsv21Data.symbol.length > 0 &&
        bsv21Data.icon !== null &&
        bsv21Data.maxSupply.length > 0
      )
    }
    return false
  }, [activeTab, file, bsv20Data.ticker, bsv21Data])

  const inscribeButtonLabel = useMemo(() => {
    if (activeTab === "bsv20") {
      return bsv20Data.mode === "mint" ? "Mint Tokens" : "Deploy Ticker"
    }
    if (activeTab === "bsv21") return "Deploy Token"
    return "Inscribe on Chain"
  }, [activeTab, bsv20Data.mode])

  const handleFileSelect = useCallback((selectedFile: File) => {
    setFile(selectedFile)
    setContentType(selectedFile.type || "application/octet-stream")
    setResult(null)
    setError(null)
  }, [])

  const handleFileRemove = useCallback(() => {
    setFile(null)
    setContentType("application/octet-stream")
    setMetadata([])
    setResult(null)
    setError(null)
  }, [])

  const handleInscribe = useCallback(async () => {
    setIsInscribing(true)
    setError(null)
    setResult(null)

    try {
      let params: InscribeParams

      if (activeTab === "file") {
        if (!file) return

        const base64Content = await fileToBase64(file)
        const map: Record<string, string> = {}
        for (const entry of metadata) {
          if (entry.key.trim() && entry.value.trim()) {
            map[entry.key.trim()] = entry.value.trim()
          }
        }

        params = {
          type: "file",
          base64Content,
          contentType,
          map,
          signWithBAP: signWithBAP || undefined,
        }
      } else if (activeTab === "bsv20") {
        params = {
          type: "bsv20",
          contentType: "application/bsv-20",
          map: {},
          bsv20: bsv20Data,
        }
      } else {
        // bsv21
        let iconBase64: string | undefined
        let iconContentType: string | undefined
        if (bsv21Data.icon) {
          iconBase64 = await fileToBase64(bsv21Data.icon)
          iconContentType = bsv21Data.icon.type || "image/png"
        }

        params = {
          type: "bsv21",
          contentType: "application/bsv-20",
          map: {},
          bsv21: {
            symbol: bsv21Data.symbol,
            maxSupply: bsv21Data.maxSupply,
            decimals: bsv21Data.decimals,
            iconBase64,
            iconContentType,
          },
        }
      }

      const inscribeResult = await onInscribe(params)

      if (inscribeResult.error) {
        setError(inscribeResult.error)
        const err = new Error(inscribeResult.error)
        onError?.(err)
      } else {
        setResult(inscribeResult)
        onSuccess?.(inscribeResult)
      }
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : "Inscription failed"
      setError(errorMessage)
      onError?.(err instanceof Error ? err : new Error(errorMessage))
    } finally {
      setIsInscribing(false)
    }
  }, [
    activeTab,
    file,
    metadata,
    contentType,
    signWithBAP,
    bsv20Data,
    bsv21Data,
    onInscribe,
    onSuccess,
    onError,
  ])

  return (
    <Card className={cn("w-full", className)}>
      <CardHeader>
        <CardTitle>Inscribe</CardTitle>
        <CardDescription>
          Create on-chain inscriptions on the BSV blockchain.
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-6">
        <Tabs
          value={activeTab}
          onValueChange={(value) => {
            if (value === "file" || value === "bsv20" || value === "bsv21") {
              setActiveTab(value)
              setResult(null)
              setError(null)
            }
          }}
        >
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="file">File</TabsTrigger>
            <TabsTrigger value="bsv20">BSV20</TabsTrigger>
            <TabsTrigger value="bsv21">BSV21</TabsTrigger>
          </TabsList>

          {/* ---- File Tab ---- */}
          <TabsContent value="file" className="mt-4 flex flex-col gap-6">
            <InscribeDropzone
              file={file}
              onFileSelect={handleFileSelect}
              onFileRemove={handleFileRemove}
              maxFileSize={maxFileSize}
            />

            {file && (
              <InscribeForm
                metadata={metadata}
                onMetadataChange={setMetadata}
                fileName={file.name}
                contentType={contentType}
                onContentTypeChange={setContentType}
                signWithBAP={signWithBAP}
                onSignWithBAPChange={setSignWithBAP}
              />
            )}
          </TabsContent>

          {/* ---- BSV20 Tab ---- */}
          <TabsContent value="bsv20" className="mt-4">
            <Bsv20Form data={bsv20Data} onDataChange={setBsv20Data} />
          </TabsContent>

          {/* ---- BSV21 Tab ---- */}
          <TabsContent value="bsv21" className="mt-4">
            <Bsv21Form data={bsv21Data} onDataChange={setBsv21Data} />
          </TabsContent>
        </Tabs>

        {/* Fee estimate */}
        {feeEstimate > 0 && (
          <>
            <Separator />
            <div className="flex items-center justify-between rounded-md border bg-muted/50 px-4 py-3">
              <span className="text-sm text-muted-foreground">
                Estimated fee
              </span>
              <Badge variant="secondary">
                ~{feeEstimate.toLocaleString()} sats
              </Badge>
            </div>
          </>
        )}

        {/* Success message */}
        {result?.txid && (
          <div className="flex items-start gap-3 rounded-md border border-primary/20 bg-primary/5 p-4">
            <CheckCircle2 className="mt-0.5 size-5 flex-shrink-0 text-primary" />
            <div className="min-w-0 flex flex-col gap-1">
              <p className="text-sm font-medium">Inscription created</p>
              <a
                href={`https://whatsonchain.com/tx/${result.txid}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 transition-colors hover:text-foreground"
              >
                <Badge variant="outline" className="max-w-full truncate text-xs font-mono">
                  {result.txid}
                </Badge>
                <ExternalLink className="size-3 flex-shrink-0" />
              </a>
            </div>
          </div>
        )}

        {/* Error message */}
        {error && (
          <div className="flex items-start gap-3 rounded-md border border-destructive/20 bg-destructive/5 p-4">
            <AlertCircle className="mt-0.5 size-5 flex-shrink-0 text-destructive" />
            <div className="flex flex-col gap-1">
              <p className="text-sm font-medium">Inscription failed</p>
              <p className="text-xs text-muted-foreground">{error}</p>
            </div>
          </div>
        )}
      </CardContent>

      <CardFooter>
        <Button
          className="w-full"
          onClick={handleInscribe}
          disabled={!canInscribe || isInscribing}
          aria-busy={isInscribing}
        >
          {isInscribing ? (
            <>
              <Loader2 className="animate-spin" data-icon="inline-start" />
              Inscribing...
            </>
          ) : (
            inscribeButtonLabel
          )}
        </Button>
      </CardFooter>
    </Card>
  )
}
