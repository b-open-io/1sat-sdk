/**
 * @1sat/protocols - Protocol implementations for 1Sat Ordinals SDK
 *
 * This package provides protocol implementations for:
 * - Sigma: Transaction data signing
 * - MAP: Magic Attribute Protocol metadata
 * - Inscription: Ordinal inscription envelope
 * - OrdP2PKH: Ordinal P2PKH with inscription support
 * - OrdLock: Marketplace listing contract
 */

// Sigma protocol
export {
	createSigma,
	isLocalSigner,
	isRemoteSigner,
	Sigma,
	signData,
} from './sigma'

// MAP protocol
export {
	appendMapToScript,
	buildMapAsm,
	buildMapScript,
	createMap,
	isValidMap,
} from './map'

// Inscription envelope
export {
	buildInscriptionEnvelope,
	buildInscriptionEnvelopeAsm,
	createInscription,
	createJsonInscription,
	hasInscriptionEnvelope,
} from './inscription'

// OrdP2PKH template
export {
	applyInscription,
	createOrdP2PKHScript,
	OrdP2PKH,
} from './ordp2pkh'

// OrdLock template
export {
	buildOutput,
	createOrdLockScript,
	isOrdLockScript,
	OrdLock,
} from './ordlock'
