// Signing abstraction
export { PrivateKeySigner, WalletSigner } from './signer.js'
export type { Signer } from './signer.js'

// Script Templates
export { default as Inscription } from './inscription/inscription.js'
export { default as BSV20 } from './bsv20/bsv20.js'
export { default as BSV21 } from './bsv21/bsv21.js'
export { default as OrdLock } from './ordlock/ordlock.js'
export { default as Lock } from './lock/lock.js'
export { default as Cosign } from './cosign/cosign.js'
export type { CosignData } from './cosign/cosign.js'
export { default as P2MS } from './multisig/multisig.js'
export type { P2MSData } from './multisig/multisig.js'

// BitCom Protocols
export { default as BitCom } from './bitcom/bitcom.js'
export { default as AIP } from './bitcom/aip.js'
export { default as B } from './bitcom/b.js'
export { default as BAP } from './bitcom/bap.js'
export { default as MAP } from './bitcom/map.js'

// BSocial
export { default as BSocial } from './bsocial/bsocial.js'

// Sigma is exported from main but also available via ./sigma subpath
// for optional peer dep isolation
export { default as Sigma } from './bitcom/sigma.js'

// ============================================================================
// Inscription Types
// ============================================================================
export type {
	InscriptionFile,
	InscriptionOptions,
} from './inscription/inscription.js'

// ============================================================================
// BSV-20 Types
// ============================================================================
export type {
	BSV20Operation,
	TokenData,
	BSV20TokenData,
	TokenOptions,
	TokenInscription,
	BSV20Inscription,
	BSV20Options,
} from './bsv20/bsv20.js'

// ============================================================================
// BSV-21 Types
// ============================================================================
export type {
	BSV21Operation,
	BSV21TokenData,
	BSV21Inscription,
	BSV21Options,
} from './bsv21/bsv21.js'

// ============================================================================
// OrdLock Types
// ============================================================================
export type { OrdLockData } from './ordlock/ordlock.js'
export { ORDLOCK_PREFIX, ORDLOCK_SUFFIX } from './ordlock/ordlock.js'

// ============================================================================
// Lock Types
// ============================================================================
export type { LockData } from './lock/lock.js'
export { LOCK_PREFIX, LOCK_SUFFIX } from './lock/lock.js'

// ============================================================================
// BitCom Types
// ============================================================================
export type {
	Protocol,
	BitComProtocol,
	BitComDecoded,
} from './bitcom/bitcom.js'

// ============================================================================
// AIP Types
// ============================================================================
export type { AIPData, AIPOptions } from './bitcom/aip.js'
export { AIP_PREFIX } from './bitcom/aip.js'

// ============================================================================
// B Types
// ============================================================================
export type { BData } from './bitcom/b.js'
export { B_PREFIX, MediaType, Encoding } from './bitcom/b.js'

// ============================================================================
// BAP Types
// ============================================================================
export type { BAPData } from './bitcom/bap.js'
export {
	BAPAttestationType,
	BAP_PROTOCOL_PREFIX,
} from './bitcom/bap.js'

// ============================================================================
// MAP Types
// ============================================================================
export type { MAPData } from './bitcom/map.js'
export { MAP_PREFIX, MAPCommand } from './bitcom/map.js'

// ============================================================================
// Sigma Types
// ============================================================================
export type {
	Sig,
	SigmaData,
	SigmaOptions,
	SignResponse,
} from './bitcom/sigma.js'
export { SIGMA_PREFIX, SigmaAlgorithm, sigmaHex } from './bitcom/sigma.js'

// ============================================================================
// BSocial Types
// ============================================================================
export {
	BSocialActionType,
	BSocialContext,
} from './bsocial/bsocial.js'
export type {
	BSocialAction,
	BSocialPost,
	BSocialLike,
	BSocialFollow,
	BSocialMessage,
	BSocialVideo,
	BSocialDecoded,
} from './bsocial/bsocial.js'
