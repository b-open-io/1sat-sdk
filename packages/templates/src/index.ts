// Signing abstraction

// ============================================================================
// AIP Types
// ============================================================================
export type { AIPData, AIPOptions } from './bitcom/aip.js'
export { AIP_PREFIX, default as AIP } from './bitcom/aip.js'
// ============================================================================
// B Types
// ============================================================================
export type { BData } from './bitcom/b.js'
export { B_PREFIX, default as B, Encoding, MediaType } from './bitcom/b.js'
// ============================================================================
// BAP Types
// ============================================================================
export type { BAPData } from './bitcom/bap.js'
export {
	BAP_PROTOCOL_PREFIX,
	BAPAttestationType,
	default as BAP,
} from './bitcom/bap.js'
// ============================================================================
// BitCom Types
// ============================================================================
export type {
	BitComDecoded,
	BitComProtocol,
	Protocol,
} from './bitcom/bitcom.js'
// BitCom Protocols
export { default as BitCom } from './bitcom/bitcom.js'
// ============================================================================
// MAP Types
// ============================================================================
export type { MAPData } from './bitcom/map.js'
export { default as MAP, MAP_PREFIX, MAPCommand } from './bitcom/map.js'
// ============================================================================
// Sigma Types
// ============================================================================
export type {
	Sig,
	SigmaData,
	SigmaOptions,
	SignResponse,
} from './bitcom/sigma.js'
// Sigma is exported from main but also available via ./sigma subpath
// for optional peer dep isolation
export {
	default as Sigma,
	SIGMA_PREFIX,
	SigmaAlgorithm,
	sigmaHex,
} from './bitcom/sigma.js'
export type {
	BSocialAction,
	BSocialDecoded,
	BSocialFollow,
	BSocialLike,
	BSocialMessage,
	BSocialPost,
	BSocialVideo,
} from './bsocial/bsocial.js'
// BSocial
// ============================================================================
// BSocial Types
// ============================================================================
export {
	BSocialActionType,
	BSocialContext,
	default as BSocial,
} from './bsocial/bsocial.js'
// ============================================================================
// BSV-20 Types
// ============================================================================
export type {
	BSV20Inscription,
	BSV20Operation,
	BSV20Options,
	BSV20TokenData,
	TokenData,
	TokenInscription,
	TokenOptions,
} from './bsv20/bsv20.js'
export { default as BSV20 } from './bsv20/bsv20.js'
// ============================================================================
// BSV-21 Types
// ============================================================================
export type {
	BSV21Inscription,
	BSV21Operation,
	BSV21Options,
	BSV21TokenData,
} from './bsv21/bsv21.js'
export { default as BSV21 } from './bsv21/bsv21.js'
export type { CosignData } from './cosign/cosign.js'
export { default as Cosign } from './cosign/cosign.js'
// ============================================================================
// Inscription Types
// ============================================================================
export type {
	InscriptionFile,
	InscriptionOptions,
} from './inscription/inscription.js'
// Script Templates
export { default as Inscription } from './inscription/inscription.js'
// ============================================================================
// Lock Types
// ============================================================================
export type { LockData } from './lock/lock.js'
export { default as Lock, LOCK_PREFIX, LOCK_SUFFIX } from './lock/lock.js'
export type { P2MSData } from './multisig/multisig.js'
export { default as P2MS } from './multisig/multisig.js'
export type { OpNSData } from './opns/opns.js'
export {
	default as OpNS,
	OPNS_CONTRACT_BYTES,
	OPNS_GENESIS_BYTES,
} from './opns/opns.js'
// ============================================================================
// OrdLock Types
// ============================================================================
export type { OrdLockData } from './ordlock/ordlock.js'
export {
	default as OrdLock,
	ORDLOCK_PREFIX,
	ORDLOCK_SUFFIX,
} from './ordlock/ordlock.js'
export type { ShrugMetadata } from './shrug/metadata.js'
export {
	decodeShrugMetadata,
	encodeShrugMetadata,
	outpointFromBytes,
	outpointToBytes,
	SHRUG_METADATA_CONTENT_TYPE,
} from './shrug/metadata.js'
export type { ShrugData } from './shrug/shrug.js'
export { default as Shrug, SHRUG_TAG_HEX } from './shrug/shrug.js'
export type { Signer } from './signer.js'
export { PrivateKeySigner, WalletSigner } from './signer.js'
