import type { TrustState } from './enrichIntent'

/**
 * Serializable prompt IR.
 *
 * Built once in the permission module after parse/enrich. The UI only renders
 * these fields — it does not re-classify scripts, tags, or baskets.
 */

export type PreviewKind =
	| 'image'
	| 'text'
	| 'json'
	| 'html'
	| 'svg'
	| 'opns'
	| 'none'

export type PanelVariant = 'ordinal' | 'token' | 'value'

/** Visual tone — burn panels use danger. */
export type PanelTone = 'default' | 'danger'

export type ValueIcon = 'lock' | 'unlock' | 'pay'

/** One labeled detail line under a panel title. */
export interface PromptDetailRow {
	key: string
	/** Display value (may be shortened for addresses/origins). */
	value: string
	/** Full string for clipboard when shortened. */
	copyValue?: string
}

/** Media for one preview slot (current output, or spent tip on reinscribe). */
export interface PromptPreview {
	previewKind?: PreviewKind
	/** Image / avatar URL when preview is image or opns avatar. */
	imageUrl?: string
	/** Fetch URL for text/json/html/svg previews. */
	contentUrl?: string
	/** Inline body when the script was decoded (mint / no OrdFS URL yet). */
	previewText?: string
}

export interface PromptPanel extends PromptPreview {
	title: string
	subtitle?: string
	subtitleCopy?: string
	meta?: PromptDetailRow[]
	variant?: PanelVariant
	/** Spent-side preview on a reinscribe panel (before → after). */
	prior?: PromptPreview
	/** Full sat amount for value panels — never truncated in the UI. */
	amountSats?: number
	valueIcon?: ValueIcon
	/** OpNS profile name shown as hero text when previewKind is opns. */
	opnsHero?: string
	/** Burn / destructive ops — subtle danger chrome. */
	tone?: PanelTone
}

/**
 * Reserved for admin pre-fund (BRC-29 payment UTXOs applied before prompt).
 * Omit until pre-fund lands — structure is here so panels are not ordinal-only.
 */
export interface PromptFunding {
	networkFeeSats?: number
	fundingInputSats?: number
	changeSats?: number
	note?: string
}

/** Overlay/indexer fee (not miner fee). */
export interface PromptIndexerFee {
	sats: number
	note?: string
}

export interface PromptTrust {
	state: TrustState
	note?: string
}

/**
 * Facts verifyIntent needs without the UI re-deriving them from tags.
 * Optional — only purchases/hint paths set trust + verify.
 */
export interface PromptVerifyContext {
	kind: string
	inputs: Array<{
		basket: string
		id: string
		outpoint: string
		satoshis: number
		tags: string[]
		/** Case-preserving fields (sym, name) — tags are lowercased by BRC-100. */
		customInstructions?: string
	}>
	outputs: Array<{
		index: number
		satoshis: number
		basket?: string
		tags: string[]
		recipient?: string
		listingPriceSats?: number
	}>
	contentUrls?: Record<string, string>
}

/**
 * Transaction prompt payload (`PromptRequest.kind === 'transaction'`).
 * Pure data — no functions, safe across process boundaries.
 */
/**
 * Serializable transaction approval view: title, panels, fees.
 * Not a classification taxonomy — pure display IR from one parse.
 */
export interface TransactionPrompt {
	/** Header title — currently always "Transaction Request". */
	title: string
	/** Header subtitle — originator line. */
	subtitle: string
	/** Primary body: one panel per op (ordinal edge, lock, pay, …). */
	panels: PromptPanel[]
	/** Secondary lines that are not full panels (leftover seals, etc.). */
	rows: PromptDetailRow[]
	trust?: PromptTrust
	indexerFee?: PromptIndexerFee
	/** Present after pre-fund; reserved until then. */
	funding?: PromptFunding
	/** Purchase verification context for the host UI. */
	verify?: PromptVerifyContext
}

export function isTransactionPrompt(
	value: unknown,
): value is TransactionPrompt {
	if (!value || typeof value !== 'object') return false
	const o = value as Record<string, unknown>
	return Array.isArray(o.panels) && typeof o.title === 'string'
}
