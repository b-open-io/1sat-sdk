"use client"

import { type VariantProps } from "class-variance-authority"
import { PostButtonUI, postButtonVariants } from "./ui"
import {
  usePost,
  type PostResult,
  type UsePostReturn,
  type UsePostOptions,
} from "./use-post"

// ---------------------------------------------------------------------------
// Re-exports
// ---------------------------------------------------------------------------

export {
  PostButtonUI,
  postButtonVariants,
  type PostButtonUIProps,
} from "./ui"
export {
  usePost,
  type PostResult,
  type UsePostReturn,
  type UsePostOptions,
} from "./use-post"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PostButtonProps
  extends VariantProps<typeof postButtonVariants> {
  /** Additional CSS classes */
  className?: string
  /** Label for the button (default: "Post") */
  label?: string
  /** Placeholder text for the textarea */
  placeholder?: string
  /** Maximum character count (0 = unlimited) */
  maxLength?: number
  /** Called to broadcast the post. Receives content string, returns result. */
  onPost: (content: string) => Promise<PostResult>
  /** Called after successful post */
  onPosted?: (result: PostResult) => void
  /** Called on error */
  onError?: (error: Error) => void
  /** Disable the button */
  disabled?: boolean
}

// ---------------------------------------------------------------------------
// Composed component
// ---------------------------------------------------------------------------

/**
 * A button that opens a compose dialog for creating on-chain BSocial posts.
 *
 * The `onPost` callback is responsible for building and broadcasting the
 * transaction (e.g. via `BSocial.createPost()` from `@1sat/templates`).
 * This component owns the UI only.
 *
 * @example
 * ```tsx
 * import { PostButton } from "@/components/blocks/post-button"
 *
 * <PostButton
 *   onPost={async (content) => {
 *     // build BSocial tx and broadcast
 *     return { txid: "abc123..." }
 *   }}
 * />
 * ```
 */
export function PostButton({
  variant = "default",
  className,
  label = "Post",
  placeholder = "What's on your mind?",
  maxLength = 0,
  onPost,
  onPosted,
  onError,
  disabled = false,
}: PostButtonProps) {
  const hook = usePost({
    maxLength,
    onPost,
    onPosted,
    onError,
  })

  return (
    <PostButtonUI
      variant={variant}
      className={className}
      label={label}
      placeholder={placeholder}
      maxLength={maxLength}
      disabled={disabled}
      dialogOpen={hook.dialogOpen}
      content={hook.content}
      onContentChange={hook.setContent}
      isPosting={hook.isPosting}
      error={hook.error}
      charCount={hook.charCount}
      overLimit={hook.overLimit}
      canSubmit={hook.canSubmit}
      onOpen={hook.handleOpen}
      onClose={hook.handleClose}
      onSubmit={hook.handleSubmit}
    />
  )
}
