"use client"

import { cn } from "@/lib/utils"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Heart, MessageCircle, ExternalLink } from "lucide-react"
import type { SocialPost } from "./use-social-feed"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PostCardUIProps {
  /** The post data to render */
  post: SocialPost
  /** Optional CSS classes */
  className?: string
  /** Called when the post card is clicked */
  onPostClick?: (post: SocialPost) => void
  /** Called when the author row is clicked */
  onAuthorClick?: (post: SocialPost) => void
  /** Slot for a custom like button component (e.g. the LikeButton block) */
  likeButtonSlot?: React.ReactNode
  /** Whether to show the reply button */
  showReplyButton?: boolean
  /** Called when the reply button is clicked */
  onReplyClick?: (post: SocialPost) => void
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Format a unix timestamp (seconds) to a relative time string */
function formatRelativeTime(timestampSeconds: number): string {
  const now = Date.now() / 1000
  const diff = now - timestampSeconds

  if (diff < 60) return "just now"
  if (diff < 3600) {
    const mins = Math.floor(diff / 60)
    return `${mins}m ago`
  }
  if (diff < 86400) {
    const hours = Math.floor(diff / 3600)
    return `${hours}h ago`
  }
  if (diff < 604800) {
    const days = Math.floor(diff / 86400)
    return `${days}d ago`
  }

  const date = new Date(timestampSeconds * 1000)
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year:
      date.getFullYear() !== new Date().getFullYear() ? "numeric" : undefined,
  })
}

/** Derive a display name from a post's signer or author data */
function getDisplayName(post: SocialPost): string {
  if (post.author?.name) return post.author.name
  if (post.signers?.[0]?.bapId) {
    const bapId = post.signers[0].bapId
    return `${bapId.slice(0, 6)}...${bapId.slice(-4)}`
  }
  if (post.signers?.[0]?.address) {
    const addr = post.signers[0].address
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`
  }
  return "Anonymous"
}

/** Derive initials for the avatar fallback */
function getInitials(name: string): string {
  if (name === "Anonymous") return "?"
  // If it looks like a truncated hash/address, use the first two chars
  if (name.includes("...")) return name.slice(0, 2).toUpperCase()
  const parts = name.trim().split(/\s+/)
  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[1][0]}`.toUpperCase()
  }
  return name.slice(0, 2).toUpperCase()
}

/** Build an ORDFS URL for embedded media */
function getMediaUrl(outpoint: string): string {
  return `https://ordfs.network/content/${outpoint}`
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function PostCardUI({
  post,
  className,
  onPostClick,
  onAuthorClick,
  likeButtonSlot,
  showReplyButton = true,
  onReplyClick,
}: PostCardUIProps) {
  const displayName = getDisplayName(post)
  const initials = getInitials(displayName)
  const avatarUrl = post.author?.avatar
  const isClickable = Boolean(onPostClick)

  return (
    <article
      className={cn(
        "group relative flex gap-3 px-4 py-3",
        isClickable &&
          "cursor-pointer hover:bg-accent/50 transition-colors duration-150",
        className
      )}
      onClick={onPostClick ? () => onPostClick(post) : undefined}
      role={isClickable ? "button" : undefined}
      tabIndex={isClickable ? 0 : undefined}
      onKeyDown={
        isClickable
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault()
                onPostClick?.(post)
              }
            }
          : undefined
      }
      data-testid="post-card"
    >
      {/* Avatar column */}
      <div className="shrink-0 pt-0.5">
        <button
          type="button"
          className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          onClick={(e) => {
            e.stopPropagation()
            onAuthorClick?.(post)
          }}
          disabled={!onAuthorClick}
          aria-label={`View profile of ${displayName}`}
        >
          <Avatar className="size-8">
            {avatarUrl && <AvatarImage src={avatarUrl} alt={displayName} />}
            <AvatarFallback>{initials}</AvatarFallback>
          </Avatar>
        </button>
      </div>

      {/* Content column */}
      <div className="flex-1 min-w-0 flex flex-col gap-1.5">
        {/* Author row */}
        <div className="flex items-center gap-2 min-w-0">
          <button
            type="button"
            className={cn(
              "truncate text-sm font-semibold text-foreground",
              onAuthorClick &&
                "hover:underline focus-visible:outline-none focus-visible:underline"
            )}
            onClick={(e) => {
              e.stopPropagation()
              onAuthorClick?.(post)
            }}
            disabled={!onAuthorClick}
          >
            {displayName}
          </button>

          {post.channel && (
            <Badge
              variant="secondary"
              className="shrink-0 text-[10px] leading-tight px-1.5 py-0"
            >
              #{post.channel}
            </Badge>
          )}

          <time
            dateTime={new Date(post.timestamp * 1000).toISOString()}
            className="shrink-0 text-xs text-muted-foreground ml-auto"
            title={new Date(post.timestamp * 1000).toLocaleString()}
          >
            {formatRelativeTime(post.timestamp)}
          </time>
        </div>

        {/* Post content */}
        <div className="text-sm text-foreground whitespace-pre-wrap break-words leading-relaxed">
          {post.content}
        </div>

        {/* Embedded media */}
        {post.mediaOutpoint && (
          <div className="mt-2 overflow-hidden rounded-lg border border-border">
            <img
              src={getMediaUrl(post.mediaOutpoint)}
              alt="Embedded media"
              className="max-h-80 w-auto object-contain"
              loading="lazy"
            />
          </div>
        )}

        {/* Action bar */}
        <div className="flex items-center gap-1 pt-1 -ml-1.5">
          {/* Like button slot or default */}
          {likeButtonSlot ?? (
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs text-muted-foreground",
                "transition-colors duration-150"
              )}
              aria-label={`${post.likes ?? 0} likes`}
            >
              <Heart className="size-3.5" aria-hidden="true" />
              {(post.likes ?? 0) > 0 && (
                <span className="tabular-nums">{post.likes}</span>
              )}
            </span>
          )}

          {/* Reply button */}
          {showReplyButton && (
            <button
              type="button"
              className={cn(
                "inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs text-muted-foreground",
                "hover:bg-accent hover:text-accent-foreground transition-colors duration-150",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              )}
              onClick={(e) => {
                e.stopPropagation()
                onReplyClick?.(post)
              }}
              disabled={!onReplyClick}
              aria-label={`${post.replies ?? 0} replies`}
            >
              <MessageCircle className="size-3.5" aria-hidden="true" />
              {(post.replies ?? 0) > 0 && (
                <span className="tabular-nums">{post.replies}</span>
              )}
            </button>
          )}

          {/* View on-chain link */}
          <a
            href={`https://whatsonchain.com/tx/${post.txid}`}
            target="_blank"
            rel="noopener noreferrer"
            className={cn(
              "inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs text-muted-foreground",
              "hover:bg-accent hover:text-accent-foreground transition-colors duration-150",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              "ml-auto"
            )}
            onClick={(e) => e.stopPropagation()}
            aria-label="View transaction on-chain"
          >
            <ExternalLink className="size-3" aria-hidden="true" />
          </a>
        </div>
      </div>
    </article>
  )
}
