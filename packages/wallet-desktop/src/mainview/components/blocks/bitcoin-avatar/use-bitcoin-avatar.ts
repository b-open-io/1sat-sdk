import { useCallback, useEffect, useState } from "react"
import { ImageProtocols } from "bitcoin-image"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UseBitcoinAvatarOptions {
  /** Bitcoin address or BAP ID used as the deterministic seed */
  address: string
  /** On-chain image URL (ord://, b://, bitfs://) to resolve and display */
  imageUrl?: string
}

export interface UseBitcoinAvatarReturn {
  /** The resolved HTTP URL for the on-chain image, or null */
  resolvedUrl: string | null
  /** Whether the on-chain image resolution failed */
  resolutionFailed: boolean
  /** Whether to show the on-chain image vs the deterministic avatar */
  showOnChainImage: boolean
  /** Mark the on-chain image as failed (e.g. on <img> load error) */
  markResolutionFailed: () => void
}

// ---------------------------------------------------------------------------
// Singleton ImageProtocols instance shared across all BitcoinAvatar mounts
// ---------------------------------------------------------------------------

let sharedImageProtocols: ImageProtocols | null = null

function getImageProtocols(): ImageProtocols {
  if (!sharedImageProtocols) {
    sharedImageProtocols = new ImageProtocols({
      cacheEnabled: true,
      cacheTTL: 3600,
    })
  }
  return sharedImageProtocols
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useBitcoinAvatar({
  address,
  imageUrl,
}: UseBitcoinAvatarOptions): UseBitcoinAvatarReturn {
  const [resolvedUrl, setResolvedUrl] = useState<string | null>(null)
  const [resolutionFailed, setResolutionFailed] = useState(false)

  // Resolve on-chain image URL when provided
  useEffect(() => {
    if (!imageUrl) {
      setResolvedUrl(null)
      setResolutionFailed(false)
      return
    }

    let cancelled = false
    setResolutionFailed(false)

    const protocols = getImageProtocols()
    protocols
      .getDisplayUrl(imageUrl)
      .then((url) => {
        if (cancelled) return
        // ImageProtocols returns its fallback data URI on failure;
        // treat that as a failed resolution so we show the sigma avatar
        const parsed = protocols.parse(imageUrl)
        if (!parsed.isValid) {
          setResolutionFailed(true)
          return
        }
        setResolvedUrl(url)
      })
      .catch(() => {
        if (!cancelled) {
          setResolutionFailed(true)
        }
      })

    return () => {
      cancelled = true
    }
  }, [imageUrl])

  const showOnChainImage = Boolean(imageUrl && resolvedUrl && !resolutionFailed)

  const markResolutionFailed = useCallback(() => {
    setResolutionFailed(true)
  }, [])

  return {
    resolvedUrl,
    resolutionFailed,
    showOnChainImage,
    markResolutionFailed,
  }
}
