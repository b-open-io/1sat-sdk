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

/** Frozen set of every valid CWIEventName value. Use for runtime validation. */
export const CWI_EVENT_NAMES: ReadonlySet<string> = new Set(
	Object.values(CWIEventName),
)

/** Type guard: true iff `s` is a valid CWIEventName. */
export const isCWIEventName = (s: unknown): s is CWIEventName =>
	typeof s === 'string' && CWI_EVENT_NAMES.has(s)

/**
 * Channel-agnostic CWI request shape. Receivers translate their on-wire
 * envelope into this shape when dispatching to a WalletInterface.
 */
export interface CWIRequest {
	action: CWIEventName
	params: unknown
	/**
	 * BRC-100 originator string. Must be infrastructure-supplied by the channel
	 * adapter (e.g. Chrome message field or MessageEvent.origin), never from the
	 * caller-facing payload.
	 */
	originator?: string
	/** Correlation id for logging / tracing. Optional. */
	id?: string
}

/** Channel-agnostic CWI response shape. */
export type CWIResponse<T = unknown> =
	| { ok: true; data: T; id?: string }
	| { ok: false; error: { message: string; code?: string }; id?: string }

/**
 * BRC-100 postMessage request envelope used by iframe/popup channels
 * (web, sigma, @1sat/connect). Previously duplicated per channel.
 */
export interface CWIRequestMessage {
	type: 'CWI'
	isInvocation: true
	id: string
	call: string
	args?: unknown
}

/** BRC-100 postMessage response envelope used by iframe/popup channels. */
export interface CWIResponseMessage {
	type: 'CWI'
	isInvocation: false
	id: string
	result?: unknown
	status?: 'error'
	description?: string
	code?: number
}
