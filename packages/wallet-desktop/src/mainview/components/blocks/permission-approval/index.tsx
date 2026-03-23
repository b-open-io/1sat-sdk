"use client"

import {
	usePermissionApproval,
	type PermissionRequest,
	type UsePermissionApprovalOptions,
} from "./use-permission-approval"
import { PermissionApprovalUi } from "./permission-approval-ui"

// Re-exports
export { usePermissionApproval } from "./use-permission-approval"
export { PermissionApprovalUi } from "./permission-approval-ui"
export type {
	PermissionRequest,
	UsePermissionApprovalOptions,
	UsePermissionApprovalReturn,
} from "./use-permission-approval"
export type { PermissionApprovalUiProps } from "./permission-approval-ui"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PermissionApprovalProps {
	/** Subscribe to incoming permission requests */
	subscribe: (handler: (request: PermissionRequest) => void) => () => void
	/** Resolve a permission request (approve or deny) */
	resolve: (params: {
		requestId: string
		approved: boolean
		error?: string
	}) => Promise<unknown>
	/** Seconds before auto-deny (default: 60) */
	timeoutSeconds?: number
	/** Optional CSS class */
	className?: string
}

// ---------------------------------------------------------------------------
// Composed Block
// ---------------------------------------------------------------------------

/**
 * Permission Approval block for BRC-100 wallet dApp authorization.
 *
 * Shows a dialog when an external application requests a sensitive wallet
 * operation. The user can approve or deny. Auto-denies after timeout.
 *
 * @example
 * ```tsx
 * import { PermissionApproval } from "@/components/blocks/permission-approval"
 *
 * <PermissionApproval
 *   subscribe={onPermissionRequest}
 *   resolve={(params) => rpc.request.resolvePermission(params)}
 * />
 * ```
 */
export function PermissionApproval({
	subscribe,
	resolve,
	timeoutSeconds,
}: PermissionApprovalProps) {
	const { pending, secondsLeft, responding, approve, deny } =
		usePermissionApproval({
			subscribe,
			resolve,
			timeoutSeconds,
		})

	return (
		<PermissionApprovalUi
			pending={pending}
			secondsLeft={secondsLeft}
			responding={responding}
			onApprove={approve}
			onDeny={deny}
		/>
	)
}
