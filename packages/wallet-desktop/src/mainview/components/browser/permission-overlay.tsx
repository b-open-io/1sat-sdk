'use client'

import { usePermissionApproval } from '@/components/blocks/permission-approval'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog'
import { ShieldAlert } from 'lucide-react'
import { onPermissionRequest, rpc } from '../../rpc'

// ---------------------------------------------------------------------------
// Helpers (duplicated from permission-approval-ui to stay self-contained)
// ---------------------------------------------------------------------------

const METHOD_LABELS: Record<string, string> = {
	createAction: 'Create Transaction',
	signAction: 'Sign Transaction',
	encrypt: 'Encrypt Data',
	decrypt: 'Decrypt Data',
	createSignature: 'Create Signature',
	createHmac: 'Create HMAC',
	acquireCertificate: 'Acquire Certificate',
}

function formatMethodLabel(method: string): string {
	return METHOD_LABELS[method] ?? method
}

/**
 * Format a 1sat:// origin for display.
 * - OpNS names (no underscore): show full, e.g. `1sat://satchmo`
 * - Outpoints: truncate txid, e.g. `1sat://abc12345...6def_0`
 * - HTTP origins: pass through unchanged.
 */
function formatOrigin(origin: string): string {
	if (!origin.startsWith('1sat://')) return origin
	const path = origin.slice(7)
	if (!path.includes('_')) return origin
	const [txid, vout] = path.split('_')
	if (txid.length === 64)
		return `1sat://${txid.slice(0, 8)}...${txid.slice(-4)}_${vout}`
	return origin
}

function summarizeArgs(method: string, args: unknown): string | null {
	if (method !== 'createAction' || !args || typeof args !== 'object') {
		return null
	}

	const a = args as Record<string, unknown>
	const outputs = a.outputs
	if (!Array.isArray(outputs) || outputs.length === 0) return null

	const totalSats = outputs.reduce(
		(sum: number, o: Record<string, unknown>) => {
			return sum + (typeof o.satoshis === 'number' ? o.satoshis : 0)
		},
		0,
	)

	const desc = typeof a.description === 'string' ? a.description : null
	const parts: string[] = []
	if (desc) parts.push(desc)
	if (totalSats > 0)
		parts.push(
			`${outputs.length} output${outputs.length > 1 ? 's' : ''}, ${totalSats} satoshis`,
		)
	else parts.push(`${outputs.length} output${outputs.length > 1 ? 's' : ''}`)

	return parts.join(' — ')
}

// ---------------------------------------------------------------------------
// PermissionOverlay
// ---------------------------------------------------------------------------

/**
 * Browser-context permission approval overlay.
 *
 * Subscribes to incoming permission requests from the RPC layer and renders
 * a modal dialog that prominently displays the 1sat:// origin, the requested
 * method, and (for createAction) a summary of outputs and satoshis.
 *
 * Auto-denies after 60 seconds.
 *
 * Wire into BrowserLayout so it is always active while the browser is shown.
 */
export function PermissionOverlay() {
	const { pending, secondsLeft, responding, approve, deny } =
		usePermissionApproval({
			subscribe: onPermissionRequest,
			resolve: (params) => rpc.request.resolvePermission(params),
			timeoutSeconds: 60,
		})

	const summary = pending ? summarizeArgs(pending.method, pending.args) : null
	const displayOrigin = pending ? formatOrigin(pending.origin) : ''
	const is1sat = pending?.origin.startsWith('1sat://')

	return (
		<Dialog
			open={!!pending}
			onOpenChange={(open) => {
				if (!open) deny()
			}}
		>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<div className="flex items-center gap-2">
						<ShieldAlert className="size-5 text-primary shrink-0" />
						<DialogTitle>Permission Request</DialogTitle>
					</div>
					<DialogDescription>
						An application is requesting wallet access.
					</DialogDescription>
				</DialogHeader>

				{pending && (
					<div className="space-y-4">
						{/* Origin — shown prominently for 1sat:// URLs */}
						<div className="flex flex-col gap-1.5">
							<span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
								Origin
							</span>
							<Badge
								variant={is1sat ? 'default' : 'secondary'}
								className="w-fit font-mono text-sm px-2 py-1"
							>
								{displayOrigin}
							</Badge>
						</div>

						{/* Requested method */}
						<div className="space-y-1">
							<span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
								This app wants to
							</span>
							<p className="text-base font-semibold text-foreground">
								{formatMethodLabel(pending.method)}
							</p>
						</div>

						{/* createAction detail summary */}
						{summary && (
							<div className="border border-border bg-muted/50 rounded p-3">
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
						<Button variant="outline" onClick={deny} disabled={responding}>
							Deny
						</Button>
						<Button onClick={approve} disabled={responding}>
							Approve
						</Button>
					</div>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	)
}
