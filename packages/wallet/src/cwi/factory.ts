/**
 * CWI Factory - Creates WalletInterface implementations with pluggable transport
 */

import type { WalletInterface } from '@bsv/sdk'
import { CWIEventName } from './types'

/**
 * Transport function signature - sends a message and returns response
 */
export type CWITransport = <TResult>(
	action: CWIEventName,
	params: unknown,
) => Promise<TResult>

/**
 * Create a WalletInterface implementation using the provided transport.
 * The transport handles the actual message passing (CustomEvent, chrome.runtime, etc.)
 */
export const createCWI = (transport: CWITransport): WalletInterface => ({
	// Output Management
	listOutputs: (args) => transport(CWIEventName.LIST_OUTPUTS, args),
	relinquishOutput: (args) => transport(CWIEventName.RELINQUISH_OUTPUT, args),

	// Action Management
	createAction: (args) => transport(CWIEventName.CREATE_ACTION, args),
	signAction: (args) => transport(CWIEventName.SIGN_ACTION, args),
	abortAction: (args) => transport(CWIEventName.ABORT_ACTION, args),
	listActions: (args) => transport(CWIEventName.LIST_ACTIONS, args),
	internalizeAction: (args) => transport(CWIEventName.INTERNALIZE_ACTION, args),

	// Key Operations
	getPublicKey: (args) => transport(CWIEventName.GET_PUBLIC_KEY, args),
	revealCounterpartyKeyLinkage: (args) =>
		transport(CWIEventName.REVEAL_COUNTERPARTY_KEY_LINKAGE, args),
	revealSpecificKeyLinkage: (args) =>
		transport(CWIEventName.REVEAL_SPECIFIC_KEY_LINKAGE, args),

	// Cryptographic Operations
	encrypt: (args) => transport(CWIEventName.ENCRYPT, args),
	decrypt: (args) => transport(CWIEventName.DECRYPT, args),
	createHmac: (args) => transport(CWIEventName.CREATE_HMAC, args),
	verifyHmac: (args) => transport(CWIEventName.VERIFY_HMAC, args),
	createSignature: (args) => transport(CWIEventName.CREATE_SIGNATURE, args),
	verifySignature: (args) => transport(CWIEventName.VERIFY_SIGNATURE, args),

	// Certificate Operations
	acquireCertificate: (args) =>
		transport(CWIEventName.ACQUIRE_CERTIFICATE, args),
	listCertificates: (args) => transport(CWIEventName.LIST_CERTIFICATES, args),
	proveCertificate: (args) => transport(CWIEventName.PROVE_CERTIFICATE, args),
	relinquishCertificate: (args) =>
		transport(CWIEventName.RELINQUISH_CERTIFICATE, args),
	discoverByIdentityKey: (args) =>
		transport(CWIEventName.DISCOVER_BY_IDENTITY_KEY, args),
	discoverByAttributes: (args) =>
		transport(CWIEventName.DISCOVER_BY_ATTRIBUTES, args),

	// Status & Info
	isAuthenticated: (args) => transport(CWIEventName.IS_AUTHENTICATED, args),
	waitForAuthentication: (args) =>
		transport(CWIEventName.WAIT_FOR_AUTHENTICATION, args),
	getHeight: (args) => transport(CWIEventName.GET_HEIGHT, args),
	getHeaderForHeight: (args) =>
		transport(CWIEventName.GET_HEADER_FOR_HEIGHT, args),
	getNetwork: (args) => transport(CWIEventName.GET_NETWORK, args),
	getVersion: (args) => transport(CWIEventName.GET_VERSION, args),
})
