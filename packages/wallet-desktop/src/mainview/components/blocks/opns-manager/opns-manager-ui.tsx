"use client"

import { useCallback, useState } from "react"
import { Globe, RefreshCw, Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Separator } from "@/components/ui/separator"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** An OpNS name to display */
export interface OpnsNameDisplay {
  /** Outpoint of the OpNS ordinal (txid_vout) */
  outpoint: string
  /** The human-readable name string */
  name: string
  /** Whether an identity key is currently bound */
  registered: boolean
  /** The bound identity public key, if registered */
  identityKey?: string
}

/** Result returned by register/deregister callbacks */
export interface OpnsOperationResult {
  /** Transaction ID on success */
  txid?: string
  /** Error message on failure */
  error?: string
}

export interface OpnsManagerUIProps {
  /** List of OpNS names to display */
  names: OpnsNameDisplay[]
  /** Whether the name list is loading */
  isLoading: boolean
  /** Whether a register/deregister operation is in progress */
  isOperating: boolean
  /** Error from the last fetch or operation */
  error: Error | null
  /** Register identity binding on a name */
  onRegister?: (name: OpnsNameDisplay) => Promise<OpnsOperationResult>
  /** Remove identity binding from a name */
  onDeregister?: (name: OpnsNameDisplay) => Promise<OpnsOperationResult>
  /** Refresh the name list */
  onRefresh?: () => void
  /** Number of skeleton rows to show while loading (default: 3) */
  skeletonCount?: number
  /** Optional CSS class name */
  className?: string
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Truncate an outpoint for display */
function truncateOutpoint(outpoint: string, maxLen = 20): string {
  if (outpoint.length <= maxLen) return outpoint
  return `${outpoint.slice(0, 10)}...${outpoint.slice(-8)}`
}

// ---------------------------------------------------------------------------
// Confirmation dialog state
// ---------------------------------------------------------------------------

type ConfirmAction = "register" | "deregister"

interface ConfirmState {
  open: boolean
  action: ConfirmAction
  name: OpnsNameDisplay | null
}

const INITIAL_CONFIRM: ConfirmState = {
  open: false,
  action: "register",
  name: null,
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

interface NameRowProps {
  name: OpnsNameDisplay
  isOperating: boolean
  onRequestRegister: (name: OpnsNameDisplay) => void
  onRequestDeregister: (name: OpnsNameDisplay) => void
  isLast: boolean
}

function NameRow({
  name,
  isOperating,
  onRequestRegister,
  onRequestDeregister,
  isLast,
}: NameRowProps) {
  const handleAction = useCallback(() => {
    if (name.registered) {
      onRequestDeregister(name)
    } else {
      onRequestRegister(name)
    }
  }, [name, onRequestRegister, onRequestDeregister])

  return (
    <>
      <div className="flex items-center gap-4 px-4 py-3">
        {/* Name icon */}
        <div className="flex size-10 flex-shrink-0 items-center justify-center rounded-full bg-muted">
          <Globe
            className="size-5 text-muted-foreground"
            aria-hidden="true"
          />
        </div>

        {/* Name + outpoint */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-sm text-foreground truncate">
              {name.name}
            </span>
            <Badge
              variant={name.registered ? "default" : "secondary"}
              className="text-[10px] px-1.5 py-0 h-5"
            >
              {name.registered ? "Registered" : "Available"}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground font-mono truncate">
            {truncateOutpoint(name.outpoint)}
          </p>
        </div>

        {/* Action button */}
        <Button
          variant={name.registered ? "outline" : "default"}
          size="sm"
          disabled={isOperating}
          onClick={handleAction}
          aria-label={
            name.registered
              ? `Deregister ${name.name}`
              : `Register ${name.name}`
          }
        >
          {isOperating ? (
            <Loader2 data-icon className="animate-spin" />
          ) : null}
          {name.registered ? "Deregister" : "Register"}
        </Button>
      </div>
      {!isLast && <Separator />}
    </>
  )
}

function SkeletonRow({ isLast }: { isLast: boolean }) {
  return (
    <>
      <div className="flex items-center gap-4 px-4 py-3">
        <Skeleton className="size-10 rounded-full flex-shrink-0" />
        <div className="flex-1 flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-5 w-16 rounded-full" />
          </div>
          <Skeleton className="h-3 w-36" />
        </div>
        <Skeleton className="h-8 w-20 rounded-md" />
      </div>
      {!isLast && <Separator />}
    </>
  )
}

// ---------------------------------------------------------------------------
// Main UI
// ---------------------------------------------------------------------------

/**
 * Pure presentation component for managing OpNS names.
 *
 * Renders a card with a list of owned OpNS names, their registration status,
 * and action buttons to register or deregister identity bindings. Includes a
 * confirmation dialog before executing on-chain operations.
 */
export function OpnsManagerUI({
  names,
  isLoading,
  isOperating,
  error,
  onRegister,
  onDeregister,
  onRefresh,
  skeletonCount = 3,
  className,
}: OpnsManagerUIProps) {
  const [confirm, setConfirm] = useState<ConfirmState>(INITIAL_CONFIRM)

  const handleRequestRegister = useCallback((name: OpnsNameDisplay) => {
    setConfirm({ open: true, action: "register", name })
  }, [])

  const handleRequestDeregister = useCallback((name: OpnsNameDisplay) => {
    setConfirm({ open: true, action: "deregister", name })
  }, [])

  const handleConfirm = useCallback(async () => {
    if (!confirm.name) return

    const handler =
      confirm.action === "register" ? onRegister : onDeregister

    if (handler) {
      await handler(confirm.name)
    }

    setConfirm(INITIAL_CONFIRM)
  }, [confirm, onRegister, onDeregister])

  const handleCancel = useCallback(() => {
    setConfirm(INITIAL_CONFIRM)
  }, [])

  // Loading state
  if (isLoading && names.length === 0) {
    return (
      <Card className={cn("w-full", className)}>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex flex-col gap-1.5">
              <CardTitle>OpNS Names</CardTitle>
              <CardDescription>Manage your on-chain name bindings</CardDescription>
            </div>
            <Skeleton className="size-8 rounded-md" />
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {Array.from({ length: skeletonCount }, (_, i) => (
            <SkeletonRow
              key={`skeleton-${i}`}
              isLast={i === skeletonCount - 1}
            />
          ))}
        </CardContent>
      </Card>
    )
  }

  // Error state
  if (error && names.length === 0) {
    return (
      <Card className={cn("w-full", className)}>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex flex-col gap-1.5">
              <CardTitle>OpNS Names</CardTitle>
              <CardDescription>Manage your on-chain name bindings</CardDescription>
            </div>
            {onRefresh && (
              <Button
                variant="ghost"
                size="icon"
                className="size-8"
                onClick={onRefresh}
                aria-label="Refresh names"
              >
                <RefreshCw data-icon />
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="flex flex-col items-center gap-2 py-10">
          <Globe
            className="size-10 text-destructive/60"
            aria-hidden="true"
          />
          <p className="text-sm font-medium text-destructive">
            Failed to load names
          </p>
          <p className="text-xs text-muted-foreground">{error.message}</p>
        </CardContent>
      </Card>
    )
  }

  // Empty state
  if (names.length === 0) {
    return (
      <Card className={cn("w-full", className)}>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex flex-col gap-1.5">
              <CardTitle>OpNS Names</CardTitle>
              <CardDescription>Manage your on-chain name bindings</CardDescription>
            </div>
            {onRefresh && (
              <Button
                variant="ghost"
                size="icon"
                className="size-8"
                onClick={onRefresh}
                aria-label="Refresh names"
              >
                <RefreshCw data-icon />
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="flex flex-col items-center gap-2 py-10">
          <Globe
            className="size-10 text-muted-foreground/50"
            aria-hidden="true"
          />
          <p className="text-sm text-muted-foreground">
            No OpNS names found
          </p>
        </CardContent>
      </Card>
    )
  }

  // Name list
  return (
    <>
      <Card className={cn("w-full overflow-hidden", className)}>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex flex-col gap-1.5">
              <CardTitle>OpNS Names</CardTitle>
              <CardDescription>Manage your on-chain name bindings</CardDescription>
            </div>
            {onRefresh && (
              <Button
                variant="ghost"
                size="icon"
                className="size-8"
                onClick={onRefresh}
                aria-label="Refresh names"
              >
                <RefreshCw data-icon />
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {names.map((name, index) => (
            <NameRow
              key={name.outpoint}
              name={name}
              isOperating={isOperating}
              onRequestRegister={handleRequestRegister}
              onRequestDeregister={handleRequestDeregister}
              isLast={index === names.length - 1}
            />
          ))}
        </CardContent>
      </Card>

      {/* Confirmation dialog */}
      <Dialog open={confirm.open} onOpenChange={(open) => {
        if (!open) handleCancel()
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {confirm.action === "register"
                ? "Register Identity"
                : "Remove Identity Binding"}
            </DialogTitle>
            <DialogDescription>
              {confirm.action === "register"
                ? `Bind your wallet's identity key to "${confirm.name?.name ?? ""}". This creates an on-chain transaction.`
                : `Remove the identity binding from "${confirm.name?.name ?? ""}". This creates an on-chain transaction.`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={handleCancel}
              disabled={isOperating}
            >
              Cancel
            </Button>
            <Button
              variant={confirm.action === "deregister" ? "destructive" : "default"}
              onClick={handleConfirm}
              disabled={isOperating}
            >
              {isOperating ? (
                <Loader2 data-icon className="animate-spin" />
              ) : null}
              {confirm.action === "register" ? "Register" : "Deregister"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
