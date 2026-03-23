"use client"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog"
import { ShieldAlert } from "lucide-react"
import type { PermissionRequest } from "./use-permission-approval"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PermissionApprovalUiProps {
	/** Currently pending request (null = dialog closed) */
	pending: PermissionRequest | null
	/** Seconds remaining before auto-deny */
	secondsLeft: number
	/** Whether a response is being sent */
	responding: boolean
	/** Approve the current request */
	onApprove: () => void
	/** Deny the current request */
	onDeny: () => void
	/** Optional CSS class */
	className?: string
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const METHOD_LABELS: Record<string, string> = {
	createAction: "Create Transaction",
	signAction: "Sign Transaction",
	encrypt: "Encrypt Data",
	decrypt: "Decrypt Data",
	createSignature: "Create Signature",
	createHmac: "Create HMAC",
	acquireCertificate: "Acquire Certificate",
}

function formatMethodLabel(method: string): string {
	return METHOD_LABELS[method] ?? method
}

function summarizeArgs(method: string, args: unknown): string | null {
	if (method !== "createAction" || !args || typeof args !== "object") {
		return null
	}

	const a = args as Record<string, unknown>
	const outputs = a.outputs
	if (!Array.isArray(outputs) || outputs.length === 0) return null

	const totalSats = outputs.reduce(
		(sum: number, o: Record<string, unknown>) => {
			return sum + (typeof o.satoshis === "number" ? o.satoshis : 0)
		},
		0,
	)

	const desc = typeof a.description === "string" ? a.description : null
	const parts: string[] = []
	if (desc) parts.push(desc)
	if (totalSats > 0)
		parts.push(
			`${outputs.length} output${outputs.length > 1 ? "s" : ""}, ${totalSats} satoshis`,
		)
	else parts.push(`${outputs.length} output${outputs.length > 1 ? "s" : ""}`)

	return parts.join(" — ")
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function PermissionApprovalUi({
	pending,
	secondsLeft,
	responding,
	onApprove,
	onDeny,
}: PermissionApprovalUiProps) {
	const summary = pending ? summarizeArgs(pending.method, pending.args) : null

	return (
		<Dialog
			open={!!pending}
			onOpenChange={(open) => {
				if (!open) onDeny()
			}}
		>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<div className="flex items-center gap-2">
						<ShieldAlert className="size-5 text-primary" />
						<DialogTitle>Permission Request</DialogTitle>
					</div>
					<DialogDescription>
						An application is requesting wallet access.
					</DialogDescription>
				</DialogHeader>

				{pending && (
					<div className="space-y-4">
						<div className="flex items-center gap-2">
							<span className="text-sm text-muted-foreground">Origin:</span>
							<Badge variant="secondary">{pending.origin}</Badge>
						</div>

						<div className="space-y-1">
							<span className="text-sm text-muted-foreground">
								This app wants to:
							</span>
							<p className="text-base font-medium text-foreground">
								{formatMethodLabel(pending.method)}
							</p>
						</div>

						{summary && (
							<div className="border border-border bg-muted/50 p-3">
								<p className="text-sm text-muted-foreground font-mono">
									{summary}
								</p>
							</div>
						)}
					</div>
				)}

				<DialogFooter className="flex-row justify-between sm:justify-between">
					<span className="text-xs text-muted-foreground self-center tabular-nums">
						Auto-deny in {secondsLeft}s
					</span>
					<div className="flex gap-2">
						<Button
							variant="outline"
							onClick={onDeny}
							disabled={responding}
						>
							Deny
						</Button>
						<Button onClick={onApprove} disabled={responding}>
							Approve
						</Button>
					</div>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	)
}
