/**
 * CWI (Compute With Integrity) - Shared types for BRC-100 WalletInterface implementations
 */

// BRC-100 Event Names - shared between all CWI implementations
export enum CWIEventName {
	// Read-only operations
	LIST_OUTPUTS = 'cwi_listOutputs',
	LIST_ACTIONS = 'cwi_listActions',
	GET_PUBLIC_KEY = 'cwi_getPublicKey',
	GET_HEIGHT = 'cwi_getHeight',
	GET_HEADER_FOR_HEIGHT = 'cwi_getHeaderForHeight',
	GET_NETWORK = 'cwi_getNetwork',
	GET_VERSION = 'cwi_getVersion',
	IS_AUTHENTICATED = 'cwi_isAuthenticated',
	WAIT_FOR_AUTHENTICATION = 'cwi_waitForAuthentication',

	// Signing operations (require password)
	CREATE_ACTION = 'cwi_createAction',
	SIGN_ACTION = 'cwi_signAction',
	ABORT_ACTION = 'cwi_abortAction',
	INTERNALIZE_ACTION = 'cwi_internalizeAction',
	CREATE_SIGNATURE = 'cwi_createSignature',
	VERIFY_SIGNATURE = 'cwi_verifySignature',
	ENCRYPT = 'cwi_encrypt',
	DECRYPT = 'cwi_decrypt',
	CREATE_HMAC = 'cwi_createHmac',
	VERIFY_HMAC = 'cwi_verifyHmac',
	RELINQUISH_OUTPUT = 'cwi_relinquishOutput',

	// Certificate operations
	ACQUIRE_CERTIFICATE = 'cwi_acquireCertificate',
	LIST_CERTIFICATES = 'cwi_listCertificates',
	PROVE_CERTIFICATE = 'cwi_proveCertificate',
	RELINQUISH_CERTIFICATE = 'cwi_relinquishCertificate',
	DISCOVER_BY_IDENTITY_KEY = 'cwi_discoverByIdentityKey',
	DISCOVER_BY_ATTRIBUTES = 'cwi_discoverByAttributes',

	// Key linkage
	REVEAL_COUNTERPARTY_KEY_LINKAGE = 'cwi_revealCounterpartyKeyLinkage',
	REVEAL_SPECIFIC_KEY_LINKAGE = 'cwi_revealSpecificKeyLinkage',
}

// Response detail structure from background.ts
export interface CWIResponseDetail<T = unknown> {
	type: CWIEventName
	success: boolean
	data?: T
	error?: string
}
