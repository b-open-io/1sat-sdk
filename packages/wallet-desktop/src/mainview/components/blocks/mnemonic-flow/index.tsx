import { MnemonicFlowUi } from './mnemonic-flow-ui'
import {
	type UseMnemonicFlowOptions,
	useMnemonicFlow,
} from './use-mnemonic-flow'

// ---------------------------------------------------------------------------
// Re-exports
// ---------------------------------------------------------------------------

export {
	MnemonicFlowUi,
	type MnemonicFlowUiProps,
} from './mnemonic-flow-ui'
export {
	MnemonicGridUi,
	type MnemonicGridUiProps,
	type WordSlotMode,
	type WordSlotProps,
} from './mnemonic-grid-ui'
export {
	type MnemonicFlowMode,
	type MnemonicWordCount,
	type UseMnemonicFlowOptions,
	type UseMnemonicFlowReturn,
	useMnemonicFlow,
	type VerificationChallenge,
} from './use-mnemonic-flow'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Props for the composed MnemonicFlow component */
export interface MnemonicFlowProps {
	/** Operating mode: display, create, import, or verify */
	mode: UseMnemonicFlowOptions['mode']
	/** Pre-populated words for display/verify modes */
	words?: string[]
	/** Number of words (12 or 24, default: 12) */
	wordCount?: UseMnemonicFlowOptions['wordCount']
	/** Called when the flow completes with the final word list */
	onComplete?: (words: string[]) => void
	/** Called when the user cancels */
	onCancel?: () => void
	/** External loading state (e.g., wallet creation in progress) */
	isLoading?: boolean
	/** External error message */
	error?: string | null
	/** Additional CSS classes */
	className?: string
}

// ---------------------------------------------------------------------------
// Composed component
// ---------------------------------------------------------------------------

/**
 * Multi-mode seed phrase display and input block.
 *
 * Composes `useMnemonicFlow` (logic) with `MnemonicFlowUi` (presentation)
 * into a single, ready-to-use component.
 *
 * Modes:
 * - **display**: Read-only numbered grid with copy-all button
 * - **create**: Generated words + display + confirmation checkbox
 * - **import**: Editable input grid for entering words
 * - **verify**: Show 2 random positions, user must type the correct words
 *
 * @example
 * ```tsx
 * import { MnemonicFlow } from "@/components/blocks/mnemonic-flow"
 *
 * <MnemonicFlow
 *   mode="create"
 *   words={generatedWords}
 *   onComplete={(words) => createWallet(words.join(" "))}
 *   onCancel={() => router.back()}
 * />
 * ```
 */
export function MnemonicFlow({
	mode,
	words: initialWords,
	wordCount = 12,
	onComplete,
	onCancel,
	isLoading = false,
	error: externalError,
	className,
}: MnemonicFlowProps) {
	const flow = useMnemonicFlow({
		mode,
		words: initialWords,
		wordCount,
		onComplete,
		onCancel,
	})

	return (
		<MnemonicFlowUi
			mode={flow.mode}
			words={flow.words}
			wordCount={flow.wordCount}
			confirmed={flow.confirmed}
			onConfirmedChange={flow.setConfirmed}
			onWordChange={flow.setWord}
			challenge={flow.challenge}
			onVerificationAnswer={flow.setVerificationAnswer}
			isValid={flow.isValid}
			canSubmit={flow.canSubmit}
			onSubmit={flow.submit}
			onCancel={flow.cancel}
			onCopy={flow.copyWords}
			copied={flow.copied}
			isLoading={isLoading}
			error={externalError ?? flow.error}
			className={className}
		/>
	)
}
