'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PermissionRequest {
	requestId: string
	method: string
	origin: string
	args: unknown
}

export interface UsePermissionApprovalOptions {
	/** Seconds before auto-deny (default: 60) */
	timeoutSeconds?: number
	/** Called when a permission request arrives */
	onRequest?: (request: PermissionRequest) => void
	/** Called to subscribe to incoming permission requests */
	subscribe: (handler: (request: PermissionRequest) => void) => () => void
	/** Called to resolve a permission request */
	resolve: (params: {
		requestId: string
		approved: boolean
		error?: string
	}) => Promise<unknown>
}

export interface UsePermissionApprovalReturn {
	/** Currently pending permission request (null if none) */
	pending: PermissionRequest | null
	/** Seconds remaining before auto-deny */
	secondsLeft: number
	/** Whether a response is being sent */
	responding: boolean
	/** Approve the current request */
	approve: () => Promise<void>
	/** Deny the current request */
	deny: () => Promise<void>
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function usePermissionApproval({
	timeoutSeconds = 60,
	onRequest,
	subscribe,
	resolve,
}: UsePermissionApprovalOptions): UsePermissionApprovalReturn {
	const [pending, setPending] = useState<PermissionRequest | null>(null)
	const [secondsLeft, setSecondsLeft] = useState(timeoutSeconds)
	const [responding, setResponding] = useState(false)
	const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
	const denyRef = useRef<() => void>(() => {})

	useEffect(() => {
		return subscribe((request) => {
			setPending(request)
			setSecondsLeft(timeoutSeconds)
			setResponding(false)
			onRequest?.(request)
		})
	}, [subscribe, timeoutSeconds, onRequest])

	const cleanup = useCallback(() => {
		if (timerRef.current) {
			clearInterval(timerRef.current)
			timerRef.current = null
		}
		setPending(null)
		setResponding(false)
	}, [])

	const approve = useCallback(async () => {
		if (!pending || responding) return
		setResponding(true)
		try {
			await resolve({ requestId: pending.requestId, approved: true })
		} catch (err) {
			console.error('[PermissionApproval] Failed to approve:', err)
		}
		cleanup()
	}, [pending, responding, resolve, cleanup])

	const deny = useCallback(async () => {
		if (!pending || responding) return
		setResponding(true)
		try {
			await resolve({
				requestId: pending.requestId,
				approved: false,
				error: 'User denied permission',
			})
		} catch (err) {
			console.error('[PermissionApproval] Failed to deny:', err)
		}
		cleanup()
	}, [pending, responding, resolve, cleanup])

	denyRef.current = deny

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

	return { pending, secondsLeft, responding, approve, deny }
}
