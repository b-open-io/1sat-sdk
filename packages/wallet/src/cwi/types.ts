/**
 * CWI (Compute With Integrity) - Shared types for BRC-100 WalletInterface implementations
 */

// BRC-100 Event Names - shared between all CWI implementations
export enum CWIEventName {
	// Read-only operations
	LIST_OUTPUTS = 'listOutputs',
	LIST_ACTIONS = 'listActions',
	GET_PUBLIC_KEY = 'getPublicKey',
	GET_HEIGHT = 'getHeight',
	GET_HEADER_FOR_HEIGHT = 'getHeaderForHeight',
	GET_NETWORK = 'getNetwork',
	GET_VERSION = 'getVersion',
	IS_AUTHENTICATED = 'isAuthenticated',
	WAIT_FOR_AUTHENTICATION = 'waitForAuthentication',

	// Signing operations (require password)
	CREATE_ACTION = 'createAction',
	SIGN_ACTION = 'signAction',
	ABORT_ACTION = 'abortAction',
	INTERNALIZE_ACTION = 'internalizeAction',
	CREATE_SIGNATURE = 'createSignature',
	VERIFY_SIGNATURE = 'verifySignature',
	ENCRYPT = 'encrypt',
	DECRYPT = 'decrypt',
	CREATE_HMAC = 'createHmac',
	VERIFY_HMAC = 'verifyHmac',
	RELINQUISH_OUTPUT = 'relinquishOutput',

	// Certificate operations
	ACQUIRE_CERTIFICATE = 'acquireCertificate',
	LIST_CERTIFICATES = 'listCertificates',
	PROVE_CERTIFICATE = 'proveCertificate',
	RELINQUISH_CERTIFICATE = 'relinquishCertificate',
	DISCOVER_BY_IDENTITY_KEY = 'discoverByIdentityKey',
	DISCOVER_BY_ATTRIBUTES = 'discoverByAttributes',

	// Key linkage
	REVEAL_COUNTERPARTY_KEY_LINKAGE = 'revealCounterpartyKeyLinkage',
	REVEAL_SPECIFIC_KEY_LINKAGE = 'revealSpecificKeyLinkage',
}

// Response detail structure from background.ts
export interface CWIResponseDetail<T = unknown> {
	type: CWIEventName
	success: boolean
	data?: T
	error?: string
}
