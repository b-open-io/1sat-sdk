import { useCallback, useState } from "react"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PostResult {
  /** Transaction ID of the on-chain post */
  txid?: string
  /** Raw transaction hex */
  rawtx?: string
  /** Error message if posting failed */
  error?: string
}

export interface UsePostOptions {
  /** Maximum character count (0 = unlimited) */
  maxLength?: number
  /** Called to broadcast the post. Receives content string, returns result. */
  onPost: (content: string) => Promise<PostResult>
  /** Called after successful post */
  onPosted?: (result: PostResult) => void
  /** Called on error */
  onError?: (error: Error) => void
}

export interface UsePostReturn {
  /** Whether the compose dialog is open */
  dialogOpen: boolean
  /** Current content of the textarea */
  content: string
  /** Set the content of the textarea */
  setContent: (content: string) => void
  /** Whether a post is being submitted */
  isPosting: boolean
  /** Error message string, if present */
  error: string | null
  /** Current character count */
  charCount: number
  /** Whether the content exceeds the max length */
  overLimit: boolean
  /** Whether the post can be submitted */
  canSubmit: boolean
  /** Open the compose dialog */
  handleOpen: () => void
  /** Close the compose dialog (resets state) */
  handleClose: () => void
  /** Submit the post */
  handleSubmit: () => Promise<void>
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function usePost({
  maxLength = 0,
  onPost,
  onPosted,
  onError,
}: UsePostOptions): UsePostReturn {
  const [dialogOpen, setDialogOpen] = useState(false)
  const [content, setContent] = useState("")
  const [isPosting, setIsPosting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const charCount = content.length
  const overLimit = maxLength > 0 && charCount > maxLength
  const canSubmit = content.trim().length > 0 && !overLimit && !isPosting

  const handleOpen = useCallback(() => {
    setDialogOpen(true)
    setError(null)
  }, [])

  const handleClose = useCallback(() => {
    if (!isPosting) {
      setDialogOpen(false)
      setContent("")
      setError(null)
    }
  }, [isPosting])

  const handleSubmit = useCallback(async () => {
    if (!canSubmit) return

    setIsPosting(true)
    setError(null)

    try {
      const result = await onPost(content.trim())

      if (result.error) {
        setError(result.error)
        onError?.(new Error(result.error))
      } else {
        onPosted?.(result)
        setDialogOpen(false)
        setContent("")
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to create post"
      setError(msg)
      onError?.(err instanceof Error ? err : new Error(msg))
    } finally {
      setIsPosting(false)
    }
  }, [canSubmit, content, onPost, onPosted, onError])

  return {
    dialogOpen,
    content,
    setContent,
    isPosting,
    error,
    charCount,
    overLimit,
    canSubmit,
    handleOpen,
    handleClose,
    handleSubmit,
  }
}
