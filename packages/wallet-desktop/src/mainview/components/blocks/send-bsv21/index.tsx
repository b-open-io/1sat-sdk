import { SendBsv21Ui } from './send-bsv21-ui'
import type {
	SendBsv21Params,
	SendBsv21Result,
	TokenBalance,
} from './use-send-bsv21'
import { useSendBsv21 } from './use-send-bsv21'

// ---------------------------------------------------------------------------
// Re-exports
// ---------------------------------------------------------------------------

export type { SendBsv21UiProps } from './send-bsv21-ui'
export { SendBsv21Ui } from './send-bsv21-ui'
export type {
	SendBsv21Params,
	SendBsv21Result,
	TokenBalance,
	UseSendBsv21Options,
	UseSendBsv21Return,
} from './use-send-bsv21'
export { useSendBsv21 } from './use-send-bsv21'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Props for the composed SendBsv21 block */
export interface SendBsv21Props {
	/** Available token balances for the selector */
	balances?: TokenBalance[]
	/** Callback to execute the token transfer */
	onSend?: (params: SendBsv21Params) => Promise<SendBsv21Result>
	/** Called on successful send */
	onSuccess?: (result: SendBsv21Result) => void
	/** Called on error */
	onError?: (error: Error) => void
	/** Optional CSS class */
	className?: string
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Full Send BSV21 Tokens block: a card form with token selector,
 * amount input with decimal formatting, recipient address, and send button.
 *
 * The `onSend` callback receives `{ tokenId, amount, address }` where
 * `amount` is a raw integer string (accounting for decimals) and should
 * call `@1sat/actions` `sendBsv21.execute(ctx, { tokenId, recipients: [{ amount, address }] })`.
 *
 * @example
 * ```tsx
 * import { SendBsv21 } from "@/components/blocks/send-bsv21"
 *
 * <SendBsv21
 *   balances={tokenBalances}
 *   onSend={async ({ tokenId, amount, address }) => {
 *     const result = await sendBsv21.execute(ctx, {
 *       tokenId,
 *       recipients: [{ amount, address }],
 *     })
 *     return result
 *   }}
 * />
 * ```
 */
export function SendBsv21({
	balances = [],
	onSend,
	onSuccess,
	onError,
	className,
}: SendBsv21Props) {
	const { isLoading, error, result, execute, reset } = useSendBsv21({
		onSend,
		onSuccess,
		onError,
	})

	return (
		<SendBsv21Ui
			balances={balances}
			isLoading={isLoading}
			error={error}
			result={result}
			onSubmit={execute}
			onReset={reset}
			className={className}
		/>
	)
}
