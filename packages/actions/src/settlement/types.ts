import type {
	CreateActionResult,
	WalletCounterparty,
	WalletProtocol,
} from '@bsv/sdk'

export const SETTLEMENT_PROTOCOL = '1sat-p2p-settlement' as const
export const SETTLEMENT_VERSION = 1 as const
export const SETTLEMENT_SIGHASH_SCOPE = 0x41 as const
export const MAX_BSV21_AMOUNT = 18_446_744_073_709_551_615n

export type SettlementChain = 'main' | 'test'
export type SettlementIdentity = string

export type LockedOfferItemV1 =
	| { kind: 'ordinal'; outpoint: string }
	| { kind: 'bsv21'; tokenId: string; amount: string }
	| { kind: 'bsv'; satoshis: string }

export interface LockedOfferV1 {
	owner: SettlementIdentity
	revision: number
	items: LockedOfferItemV1[]
}

export interface LockedOfferCommitmentV1 {
	protocol: typeof SETTLEMENT_PROTOCOL
	version: typeof SETTLEMENT_VERSION
	chain: SettlementChain
	sessionId: string
	parties: [SettlementIdentity, SettlementIdentity]
	offers: LockedOfferV1[]
	builder: SettlementIdentity
	feePayer: SettlementIdentity
	expiresAt: number
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
	destinationProof: string
	destinationVerified: boolean
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
	offerDigest: string
	reservationId: string
	reservationExpiresAt: number
	inputs: SettlementAssetInputV1[]
	destinations: SettlementDestinationV1[]
	contributionHash: string
}

export interface SettlementPlanV1 {
	lockedOffer: LockedOfferCommitmentV1
	offerDigest: string
	settlementId: string
	attempt: number
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
	protocol: typeof SETTLEMENT_PROTOCOL
	version: typeof SETTLEMENT_VERSION
	chain: SettlementChain
	sessionId: string
	settlementId: string
	attempt: number
	offerDigest: string
	builder: SettlementIdentity
	expiresAt: number
	unsignedTxHash: string
	inputs: TemplateManifestInputV1[]
	outputs: TemplateManifestOutputV1[]
	overlayPolicies: TemplateOverlayPolicyV1[]
}

export interface SettlementTemplateV1 {
	manifest: TemplateManifestV1
	templateHash: string
	signableBeefHash: string
	contributionHashes: [string, string]
	signableBeef: number[]
}

export interface BuilderLocalSettlementActionV1 {
	reference: string
	createResult: CreateActionResult
	template: SettlementTemplateV1
}

export interface SettlementReservationRequestV1 {
	settlementId: string
	attempt: number
	offerDigest: string
	walletIdentity: string
	providerInstanceId: string
	expiresAt: number
	outpoints: string[]
}

export interface SettlementReservationLeaseV1 {
	reservationId: string
	request: SettlementReservationRequestV1
	expiresAt: number
}

export interface SettlementReservationAdapter {
	reserve(
		request: SettlementReservationRequestV1,
	): Promise<SettlementReservationLeaseV1>
	validate(lease: SettlementReservationLeaseV1): Promise<boolean>
	release(lease: SettlementReservationLeaseV1): Promise<void>
}

export interface SettlementSigningMetadataV1 {
	inputIndex: number
	protocolID: WalletProtocol
	keyID: string
	counterparty?: WalletCounterparty
	template: 'p2pkh' | 'pushdrop'
}

export interface SettlementSigningInputV1 {
	inputIndex: number
	outpoint: string
	preimage: number[]
	sighash: number[]
	sighashScope: typeof SETTLEMENT_SIGHASH_SCOPE
}

export interface SettlementSigningRequestV1 {
	protocol: typeof SETTLEMENT_PROTOCOL
	version: typeof SETTLEMENT_VERSION
	chain: SettlementChain
	sessionId: string
	settlementId: string
	attempt: number
	offerDigest: string
	templateHash: string
	contributionHash: string
	owner: SettlementIdentity
	authorizationExpiresAt: number
	inputs: SettlementSigningInputV1[]
}

export interface SettlementAuthorizationV1 {
	offerDigest: string
	templateHash: string
	contributionHash: string
	owner: SettlementIdentity
	authorizedInputs: Array<{
		inputIndex: number
		unlockingScriptHash: string
	}>
	authorizationExpiresAt: number
	spends: Record<number, { unlockingScript: string }>
}

export interface ReplayRecordV1 {
	key: string
	digest: string
	expiresAt: number
}

export type SettlementReplayStoreResult = 'stored' | 'unchanged' | 'conflict'

export interface SettlementReplayStore {
	/** Atomically insert, replace an expired record, or compare a live digest. */
	putIfAbsentOrSame(
		record: ReplayRecordV1,
		now: number,
	): Promise<SettlementReplayStoreResult>
}
