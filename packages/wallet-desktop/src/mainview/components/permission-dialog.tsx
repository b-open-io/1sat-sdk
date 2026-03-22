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
import { useCallback, useEffect, useRef, useState } from 'react'
import type { PermissionRequest } from '../../shared/types'
import { onPermissionRequest, rpc } from '../rpc'

/** Human-readable labels for BRC-100 method names. */
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

/** Extract a brief summary from createAction args if available. */
function summarizeArgs(method: string, args: unknown): string | null {
	if (method !== 'createAction' || !args || typeof args !== 'object') {
		return null
	}

	const a = args as Record<string, unknown>
	const outputs = a.outputs
	if (!Array.isArray(outputs) || outputs.length === 0) return null

	const totalSats = outputs.reduce((sum: number, o: Record<string, unknown>) => {
		return sum + (typeof o.satoshis === 'number' ? o.satoshis : 0)
	}, 0)

	const desc = typeof a.description === 'string' ? a.description : null

	const parts: string[] = []
	if (desc) parts.push(desc)
	if (totalSats > 0) parts.push(`${outputs.length} output${outputs.length > 1 ? 's' : ''}, ${totalSats} satoshis`)
	else parts.push(`${outputs.length} output${outputs.length > 1 ? 's' : ''}`)

	return parts.join(' - ')
}

export function PermissionDialog() {
	const [pending, setPending] = useState<PermissionRequest | null>(null)
	const [secondsLeft, setSecondsLeft] = useState(60)
	const [responding, setResponding] = useState(false)
	const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
	const denyRef = useRef<() => void>(() => {})

	// Subscribe to permission requests from Bun
	useEffect(() => {
		return onPermissionRequest((request) => {
			setPending(request)
			setSecondsLeft(60)
			setResponding(false)
		})
	}, [])

	const cleanup = useCallback(() => {
		if (timerRef.current) {
			clearInterval(timerRef.current)
			timerRef.current = null
		}
		setPending(null)
		setResponding(false)
	}, [])

	const handleApprove = useCallback(async () => {
		if (!pending || responding) return
		setResponding(true)
		try {
			await rpc.request.resolvePermission({
				requestId: pending.requestId,
				approved: true,
			})
		} catch (err) {
			console.error('[Permission] Failed to send approval:', err)
		}
		cleanup()
	}, [pending, responding, cleanup])

	const handleDeny = useCallback(async () => {
		if (!pending || responding) return
		setResponding(true)
		try {
			await rpc.request.resolvePermission({
				requestId: pending.requestId,
				approved: false,
				error: 'User denied permission',
			})
		} catch (err) {
			console.error('[Permission] Failed to send denial:', err)
		}
		cleanup()
	}, [pending, responding, cleanup])

	// Keep ref in sync so the interval always calls the latest handleDeny
	denyRef.current = handleDeny

	// Countdown timer — auto-deny when it hits 0
	useEffect(() => {
		if (!pending) return

		timerRef.current = setInterval(() => {
			setSecondsLeft((prev) => {
				if (prev <= 1) {
					denyRef.current()
					return 0
				}
				return prev - 1
			})
		}, 1000)

		return () => {
			if (timerRef.current) {
				clearInterval(timerRef.current)
				timerRef.current = null
			}
		}
	}, [pending?.requestId])

	const summary = pending ? summarizeArgs(pending.method, pending.args) : null

	return (
		<Dialog open={!!pending} onOpenChange={(open) => { if (!open) handleDeny() }}>
			<DialogContent showCloseButton={false} className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle>Permission Request</DialogTitle>
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
							<div className="rounded-md border border-border bg-muted/50 p-3">
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
							onClick={handleDeny}
							disabled={responding}
						>
							Deny
						</Button>
						<Button onClick={handleApprove} disabled={responding}>
							Approve
						</Button>
					</div>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	)
}
