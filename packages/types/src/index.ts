/**
 * @1sat/types - Type definitions for 1Sat Ordinals SDK
 *
 * These types are designed for transaction building and are compatible with js-1sat-ord.
 * For wallet indexing/parsing, see @1sat/wallet which uses different internal types
 * optimized for runtime processing.
 */

import type { PrivateKey, Script, Transaction } from '@bsv/sdk'
import type { Destination } from './destination.js'

// ============================================================================
// Signer Types
// ============================================================================

/**
 * Local signer using a private key directly
 */
export interface LocalSigner {
	idKey: PrivateKey
}

/**
 * Remote signer delegating to a signing service
 */
export interface RemoteSigner {
	keyHost: string
	authToken?: AuthToken
	/** How to deliver the auth token over HTTP (for SIGMA protocol) */
	transport?: AuthTransport
}

/**
 * Signer - either local (private key) or remote (signing service)
 */
export type Signer = LocalSigner | RemoteSigner

/**
 * Authentication token - the signed proof
 * Compatible with bitcoin-auth and extensible for future standards (CAIP-122)
 *
 * Serializes to: `${pubkey}|${scheme}|${timestamp}|${requestPath}|${signature}`
 */
export interface AuthToken {
	/** Signer's public key (hex) */
	pubkey: string
	/** Signature algorithm: 'bsm', 'brc77', or extensible string */
	scheme: 'bsm' | 'brc77' | string
	/** ISO8601 timestamp */
	timestamp: string
	/** Resource being accessed */
	requestPath: string
	/** The cryptographic signature */
	signature: string
}

/**
 * HTTP transport configuration for auth tokens (used by SIGMA protocol)
 */
export interface AuthTransport {
	type: 'header' | 'query'
	key: string
}

// ============================================================================
// UTXO Types
// ============================================================================

/**
 * Base UTXO for transaction building
 *
 * @property satoshis - Amount in satoshis
 * @property txid - Transaction ID (64 char hex)
 * @property vout - Output index
 * @property script - Base64 encoded locking script
 * @property pk - Optional private key for unlocking
 */
export type Utxo = {
	satoshis: number
	txid: string
	vout: number
	script: string
	pk?: PrivateKey
}

/**
 * NFT UTXO - 1-satoshi output containing an ordinal inscription
 */
export interface NftUtxo extends Utxo {
	collectionId?: string
	contentType: string
	creatorBapId?: string
	origin: string
	satoshis: 1
	pk?: PrivateKey
}

/**
 * Token UTXO - 1-satoshi output containing BSV20/BSV21 tokens
 *
 * @property amt - Token amount as string in 'tsat' format (e.g., "100000000" = 1 token with 8 decimals)
 * @property id - Token identifier (tick for BSV20, origin for BSV21)
 */
export interface TokenUtxo extends Utxo {
	amt: string
	id: string
	satoshis: 1
	payout?: string
	price?: number
	isListing?: boolean
	pk?: PrivateKey
}

// ============================================================================
// Token Types
// ============================================================================

export enum TokenType {
	BSV20 = 'bsv20',
	BSV21 = 'bsv21',
}

export enum TokenSelectionStrategy {
	SmallestFirst = 'smallest',
	LargestFirst = 'largest',
	RetainOrder = 'retain',
	Random = 'random',
}

export enum TokenInputMode {
	All = 'all',
	Needed = 'needed',
}

export interface TokenSelectionOptions {
	inputStrategy?: TokenSelectionStrategy
	outputStrategy?: TokenSelectionStrategy
}

export interface TokenSelectionResult {
	selectedUtxos: TokenUtxo[]
	totalSelected: number
	isEnough: boolean
}

/**
 * Token distribution recipient
 *
 * @property address - Destination address or Script
 * @property tokens - Amount in display format (e.g., 0.5 for half a token)
 * @property omitMetaData - Omit MAP metadata from this output
 */
export type Distribution = {
	address: string | Script
	tokens: number
	omitMetaData?: boolean
}

/**
 * Configuration for splitting token change outputs
 */
export type TokenSplitConfig = {
	outputs: number
	threshold?: number
	omitMetaData?: boolean
}

// ============================================================================
// Inscription Types
// ============================================================================

export type Inscription = {
	dataB64: string
	contentType: string
}

export type ImageContentType =
	| 'image/png'
	| 'image/jpeg'
	| 'image/gif'
	| 'image/svg+xml'
	| 'image/webp'

export type IconInscription = {
	dataB64: string
	contentType: ImageContentType
}

/**
 * Recipient for ordinal-minting flows. Pairs a {@link Destination} (locking
 * spec) with the inscription content to embed at that output. Used by
 * CreateOrdinalsConfig, SendOrdinalsConfig, and the collection variants.
 */
export type OrdinalRecipient = {
	destination: Destination
	inscription?: Inscription
}

// ============================================================================
// Token Inscription Types (JSON inscribed in ordinals)
// ============================================================================

export type TokenInscription = {
	p: 'bsv-20'
	amt: string
	op: 'transfer' | 'mint' | 'deploy+mint' | 'burn'
	dec?: string
}

export interface MintTokenInscription extends TokenInscription {
	op: 'mint'
}

export interface DeployMintTokenInscription extends TokenInscription {
	op: 'deploy+mint'
	sym: string
	icon: string
}

export interface TransferTokenInscription extends TokenInscription {
	p: 'bsv-20'
	amt: string
	op: 'transfer' | 'burn'
}

export interface TransferBSV20Inscription extends TransferTokenInscription {
	tick: string
}

export interface TransferBSV21Inscription extends TransferTokenInscription {
	id: string
}

// ============================================================================
// Payment & Listing Types
// ============================================================================

export type Payment = {
	to: string
	amount: number
}

export type NewListing = {
	payAddress: string
	price: number
	ordAddress: string
	listingUtxo: Utxo
}

export type ExistingListing = {
	payout: string
	listingUtxo: Utxo
}

export type NewTokenListing = {
	payAddress: string
	price: number
	tokens: number
	ordAddress: string
}

// Note: Preserving typo "RoytaltyType" for js-1sat-ord compatibility
export enum RoytaltyType {
	Paymail = 'paymail',
	Address = 'address',
	Script = 'script',
}

export type Royalty = {
	type: RoytaltyType
	destination: string
	percentage: string
}

// ============================================================================
// Result Types
// ============================================================================

export type BaseResult = {
	tx: Transaction
	spentOutpoints: string[]
}

export interface ChangeResult extends BaseResult {
	payChange?: Utxo
}

export interface TokenChangeResult extends ChangeResult {
	tokenChange?: TokenUtxo[]
}

// ============================================================================
// MAP Protocol Types
// ============================================================================

/**
 * MAP metadata with all values stringified (ready for blockchain)
 */
export type MAP = {
	app?: string
	type?: string
	[prop: string]: string | undefined
}

/**
 * PreMAP - metadata before stringification (allows objects/arrays)
 */
export type PreMAP = {
	app: string
	type: string
	[prop: string]: unknown
	royalties?: Royalty[]
	subTypeData?: CollectionSubTypeData | CollectionItemSubTypeData
}

export interface BurnMAP extends MAP {
	type: 'ord'
	op: 'burn'
}

// ============================================================================
// Collection Types
// ============================================================================

export type Rarity = {
	[key: string]: string
}

export type RarityLabels = Rarity[]

export type CollectionTrait = {
	values: string[]
	occurancePercentages: string[]
}

export type CollectionTraits = {
	[trait: string]: CollectionTrait
}

export interface CollectionSubTypeData {
	description: string
	quantity: number
	rarityLabels: RarityLabels
	traits: CollectionTraits
}

export type CollectionItemTrait = {
	name: string
	value: string
	rarityLabel?: string
	occurancePercentrage?: string // Note: typo preserved for compatibility
}

export type CollectionItemAttachment = {
	name: string
	description?: string
	'content-type': string
	url: string
}

export interface CollectionItemSubTypeData {
	collectionId: string
	mintNumber?: number
	rank?: number
	rarityLabel?: RarityLabels
	traits?: CollectionItemTrait[]
	attachments?: CollectionItemAttachment[]
}

// ============================================================================
// Ordinal Metadata Types
// ============================================================================

export interface CreateOrdinalsMetadata extends PreMAP {
	type: 'ord'
	name: string
	previewUrl?: string
}

export interface CreateOrdinalsCollectionMetadata
	extends CreateOrdinalsMetadata {
	subType: 'collection'
	subTypeData: CollectionSubTypeData
	royalties?: Royalty[]
}

export interface CreateOrdinalsCollectionItemMetadata extends PreMAP {
	type: 'ord'
	name: string
	subType: 'collectionItem'
	subTypeData: CollectionItemSubTypeData
	previewUrl?: string
}

// ============================================================================
// Configuration Types
// ============================================================================

export type CreateOrdinalsConfig = {
	utxos: Utxo[]
	destinations: OrdinalRecipient[]
	paymentPk?: PrivateKey
	changeAddress?: string
	satsPerKb?: number
	metaData?: PreMAP
	signer?: LocalSigner | RemoteSigner
	additionalPayments?: Payment[]
	/** When false, inputs are added without unlocking scripts and tx.sign() is skipped. Default: true */
	signInputs?: boolean
}

export interface CreateOrdinalsCollectionConfig extends CreateOrdinalsConfig {
	metaData: CreateOrdinalsCollectionMetadata
}

export interface CreateOrdinalsCollectionItemConfig
	extends CreateOrdinalsConfig {
	metaData: CreateOrdinalsCollectionItemMetadata
}

export type BurnOrdinalsConfig = {
	ordPk?: PrivateKey
	ordinals: Utxo[]
	metaData?: BurnMAP
}

export type SendOrdinalsConfig = {
	paymentUtxos: Utxo[]
	ordinals: Utxo[]
	paymentPk?: PrivateKey
	ordPk?: PrivateKey
	destinations: OrdinalRecipient[]
	changeAddress?: string
	satsPerKb?: number
	metaData?: PreMAP
	signer?: LocalSigner | RemoteSigner
	additionalPayments?: Payment[]
	enforceUniformSend?: boolean
	/** When false, inputs are added without unlocking scripts and tx.sign() is skipped. Default: true */
	signInputs?: boolean
}

export type DeployBsv21TokenConfig = {
	symbol: string
	decimals?: number
	icon: string | IconInscription
	utxos: Utxo[]
	initialDistribution: Distribution
	paymentPk?: PrivateKey
	destinationAddress: string
	changeAddress?: string
	satsPerKb?: number
	additionalPayments?: Payment[]
	signer?: LocalSigner | RemoteSigner
	/** When false, inputs are added without unlocking scripts and tx.sign() is skipped. Default: true */
	signInputs?: boolean
}

export type SendUtxosConfig = {
	utxos: Utxo[]
	paymentPk?: PrivateKey
	payments: Payment[]
	satsPerKb?: number
	changeAddress?: string
	metaData?: MAP
	signer?: LocalSigner | RemoteSigner
	/** When false, inputs are added without unlocking scripts and tx.sign() is skipped. Default: true */
	signInputs?: boolean
}

export type TransferOrdTokensConfig = {
	protocol: TokenType
	tokenID: string
	decimals: number
	utxos: Utxo[]
	inputTokens: TokenUtxo[]
	distributions: Distribution[]
	paymentPk?: PrivateKey
	ordPk?: PrivateKey
	inputMode?: TokenInputMode
	changeAddress?: string
	tokenChangeAddress?: string
	satsPerKb?: number
	metaData?: PreMAP
	signer?: LocalSigner | RemoteSigner
	additionalPayments?: Payment[]
	burn?: boolean
	splitConfig?: TokenSplitConfig
	tokenInputMode?: TokenInputMode
	/** When false, inputs are added without unlocking scripts and tx.sign() is skipped. Default: true */
	signInputs?: boolean
}

export type CreateOrdListingsConfig = {
	utxos: Utxo[]
	listings: NewListing[]
	paymentPk?: PrivateKey
	ordPk: PrivateKey
	changeAddress?: string
	satsPerKb?: number
	additionalPayments?: Payment[]
	signer?: LocalSigner | RemoteSigner
	/** When false, inputs are added without unlocking scripts and tx.sign() is skipped. Default: true */
	signInputs?: boolean
}

export type PurchaseOrdListingConfig = {
	utxos: Utxo[]
	paymentPk?: PrivateKey
	listing: ExistingListing
	ordAddress: string
	changeAddress?: string
	satsPerKb?: number
	additionalPayments?: Payment[]
	royalties?: Royalty[]
	metaData?: MAP
}

export type PurchaseOrdTokenListingConfig = {
	protocol: TokenType
	tokenID: string
	utxos: Utxo[]
	paymentPk?: PrivateKey
	listingUtxo: TokenUtxo
	ordAddress: string
	changeAddress?: string
	satsPerKb?: number
	additionalPayments?: Payment[]
	metaData?: MAP
}

export type CancelOrdListingsConfig = {
	utxos: Utxo[]
	paymentPk?: PrivateKey
	ordPk?: PrivateKey
	listingUtxos: Utxo[]
	additionalPayments?: Payment[]
	changeAddress?: string
	satsPerKb?: number
}

export interface CancelOrdTokenListingsConfig extends CancelOrdListingsConfig {
	utxos: Utxo[]
	paymentPk?: PrivateKey
	ordPk?: PrivateKey
	listingUtxos: TokenUtxo[]
	additionalPayments: Payment[]
	changeAddress?: string
	satsPerKb?: number
	protocol: TokenType
	tokenID: string
	ordAddress?: string
}

export interface CreateOrdTokenListingsConfig {
	utxos: Utxo[]
	listings: NewTokenListing[]
	paymentPk?: PrivateKey
	ordPk?: PrivateKey
	changeAddress?: string
	satsPerKb?: number
	additionalPayments?: Payment[]
	protocol: TokenType
	tokenID: string
	decimals: number
	inputTokens: TokenUtxo[]
	tokenChangeAddress: string
	signer?: LocalSigner | RemoteSigner
	/** When false, inputs are added without unlocking scripts and tx.sign() is skipped. Default: true */
	signInputs?: boolean
}

// ============================================================================
// Additional exports
// ============================================================================

export * from './constants.js'
export * from './ordinalTags.js'
export * from './destination.js'
export * from './services.js'
export * from './indexer.js'
export * from './address-sync.js'
