import type {
	CreateActionResult,
	WalletCounterparty,
	WalletProtocol,
} from '@bsv/sdk'

export const MAX_BSV21_AMOUNT = 18_446_744_073_709_551_615n
export const MAX_SETTLEMENT_ASSET_INPUTS = 256
export const MAX_SETTLEMENT_OUTPUTS = 512
export const MAX_SETTLEMENT_BEEF_BYTES = 16 * 1024 * 1024
export const MAX_SETTLEMENT_SCRIPT_BYTES = 100_000

export type SettlementChain = 'main' | 'test'
export type SettlementIdentity = string

export type SettlementAssetV1 =
	| { kind: 'ordinal'; outpoint: string }
	| { kind: 'bsv21'; tokenId: string; amount: string }
	| { kind: 'bsv'; satoshis: string }

export interface SettlementOfferV1 {
	owner: SettlementIdentity
	items: SettlementAssetV1[]
}

export interface Bsv21TipCandidateV1 {
	outpoint: string
	tokenId: string
	amount: string
	operation: 'transfer' | 'auth' | 'mint' | 'burn' | 'deploy'
	active: boolean
	unspent: boolean
	statusCheckedAt: number
	sourceSatoshis: string
	sourceScriptHash: string
	sourceBeefHash: string
}

export interface SelectedBsv21TipsV1 {
	tokenId: string
	requestedAmount: string
	selectedAmount: string
	changeAmount: string
	tips: Bsv21TipCandidateV1[]
}

export interface SettlementAssetInputV1 {
	outpoint: string
	owner: SettlementIdentity
	purpose: 'ordinal' | 'bsv21'
	tokenId?: string
	tokenAmount?: string
	sourceSatoshis: string
	sourceScriptHash: string
	sourceBeefHash: string
	active: boolean
	unspent: boolean
	statusCheckedAt: number
	operation?: 'transfer' | 'auth' | 'mint' | 'burn' | 'deploy'
}

export interface SettlementDestinationV1 {
	legIndex: number
	owner: SettlementIdentity
	purpose: 'ordinal-receipt' | 'bsv21-receipt' | 'bsv21-change' | 'bsv-payment'
	lockingScript: string
	satoshis: string
	tokenId?: string
	tokenAmount?: string
	sourceOrdinal?: string
}

export interface OverlayPolicyV1 {
	tokenId: string
	statusCheckedAt: number
	feeAddress: string
	feeLockingScript: string
	feePerOutput: string
}

export interface SettlementContributionV1 {
	owner: SettlementIdentity
	inputs: SettlementAssetInputV1[]
	destinations: SettlementDestinationV1[]
}

export interface SettlementPlanV1 {
	chain: SettlementChain
	parties: [SettlementIdentity, SettlementIdentity]
	offers: [SettlementOfferV1, SettlementOfferV1]
	builder: SettlementIdentity
	contributions: [SettlementContributionV1, SettlementContributionV1]
	overlayPolicies: OverlayPolicyV1[]
	sourceBEEFs: Array<{ hash: string; beef: number[] }>
}

export type ManifestInputPurpose = 'ordinal' | 'bsv21' | 'bsv-funding'
export type ManifestOutputPurpose =
	| 'ordinal-receipt'
	| 'bsv21-receipt'
	| 'bsv21-change'
	| 'bsv-payment'
	| 'overlay-fee'
	| 'builder-change'

export interface TemplateManifestInputV1 {
	sequence: number
	index: number
	outpoint: string
	owner: SettlementIdentity | 'builder-funding'
	purpose: ManifestInputPurpose
	tokenId?: string
	tokenAmount?: string
	sourceSatoshis: string
	sourceScriptHash: string
}

export interface TemplateManifestOutputV1 {
	index: number
	owner: SettlementIdentity | 'overlay-fee' | 'builder-change'
	purpose: ManifestOutputPurpose
	satoshis: string
	scriptHash: string
	tokenId?: string
	tokenAmount?: string
	sourceOrdinal?: string
}

export interface TemplateOverlayPolicyV1 {
	tokenId: string
	statusCheckedAt: number
	feeAddress: string
	feePerOutput: string
	countedOutputs: number
	totalFee: string
}

export interface TemplateManifestV1 {
	version: number
	lockTime: number
	chain: SettlementChain
	builder: SettlementIdentity
	inputs: TemplateManifestInputV1[]
	outputs: TemplateManifestOutputV1[]
	overlayPolicies: TemplateOverlayPolicyV1[]
}

export interface SettlementTemplateV1 {
	manifest: TemplateManifestV1
	signableBeef: number[]
}

export interface BuilderLocalSettlementActionV1 {
	reference: string
	createResult: CreateActionResult
	template: SettlementTemplateV1
}

export interface SettlementSigningMetadataV1 {
	inputIndex: number
	protocolID: WalletProtocol
	keyID: string
	counterparty?: WalletCounterparty
}

export interface SettlementAuthorizationV1 {
	owner: SettlementIdentity
	spends: Record<number, { unlockingScript: string }>
}
