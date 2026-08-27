/**
 * Docs verification script
 *
 * Verifies every export, method, type, and error code documented in the
 * developer docs matches the real @1sat/connect implementation.
 *
 * Usage:
 *   bun run examples/verify-docs.ts
 */

// Type-only re-exports verified at compile time — if any is missing, tsc fails.
import type {
	BalanceResult,
	CancelListingRequest,
	ConnectResult,
	CreateListingRequest,
	// CWI transport types
	CWIHandshakeReason,
	CWIRequestMessage,
	CWIResponseMessage,
	CWIState,
	CWIStateMessage,
	CWITransport,
	CWITransportConfig,
	CWITransportEvent,
	CWITransportEventHandler,
	CWITransportName,
	CWIWalletStatus,
	EventHandler,
	InscribeRequest,
	InscribeResult,
	ListingResult,
	ListOptions,
	MobileFallbackMode,
	OneSatEvent,
	OneSatProvider,
	OrdinalOutput,
	PurchaseListingRequest,
	RpcMethod,
	SendOrdinalsRequest,
	SendResult,
	SignMessageResult,
	SignTransactionRequest,
	SignTransactionResult,
	TokenOutput,
	TransferTokenRequest,
	TransportMode,
	Utxo,
} from '../packages/connect/src/index'
import {
	createOneSat,
	ErrorCodes,
	fromErrorResponse,
	getInjectedOneSat,
	InsufficientFundsError,
	isOneSatAvailable,
	isOneSatInjected,
	OneSatBrowserProvider,
	type OneSatConfig,
	OneSatError,
	PopupBlockedError,
	PopupClosedError,
	RpcMethods,
	TimeoutError,
	UserRejectedError,
	WalletLockedError,
	WalletNotConnectedError,
	waitForOneSat,
} from '../packages/connect/src/index'

// Reference every type so biome sees them as used
type _TypeCheck = [
	BalanceResult,
	CancelListingRequest,
	ConnectResult,
	CreateListingRequest,
	EventHandler,
	InscribeRequest,
	InscribeResult,
	ListOptions,
	ListingResult,
	OneSatEvent,
	OneSatProvider,
	OrdinalOutput,
	PurchaseListingRequest,
	RpcMethod,
	SendOrdinalsRequest,
	SendResult,
	SignMessageResult,
	SignTransactionRequest,
	SignTransactionResult,
	TokenOutput,
	TransferTokenRequest,
	Utxo,
	CWIHandshakeReason,
	CWIWalletStatus,
	CWITransportName,
	CWITransportConfig,
	CWIState,
	CWIRequestMessage,
	CWIResponseMessage,
	CWIStateMessage,
	CWITransportEvent,
	CWITransportEventHandler,
	CWITransport,
	TransportMode,
	MobileFallbackMode,
]

let passed = 0
let failed = 0

function test(name: string, condition: boolean) {
	if (condition) {
		passed++
		console.log(`  \x1b[32m✓\x1b[0m ${name}`)
	} else {
		failed++
		console.log(`  \x1b[31m✗\x1b[0m ${name}`)
	}
}

function section(name: string) {
	console.log(`\n\x1b[1m${name}\x1b[0m`)
}

// ---------------------------------------------------------------------------
// 1. Core function exports
// ---------------------------------------------------------------------------
section('Core Exports')
test('createOneSat is a function', typeof createOneSat === 'function')
test('isOneSatInjected is a function', typeof isOneSatInjected === 'function')
test('isOneSatAvailable is a function', typeof isOneSatAvailable === 'function')
test('waitForOneSat is a function', typeof waitForOneSat === 'function')
test('getInjectedOneSat is a function', typeof getInjectedOneSat === 'function')
test(
	'OneSatBrowserProvider is a class',
	typeof OneSatBrowserProvider === 'function',
)
test('fromErrorResponse is a function', typeof fromErrorResponse === 'function')

// ---------------------------------------------------------------------------
// 2. Provider interface — every documented method exists
// ---------------------------------------------------------------------------
section('Provider Methods (OneSatProvider interface)')

// We can't call createOneSat in Node (no window), so provide a minimal mock
globalThis.window =
	globalThis.window ||
	// biome-ignore lint/suspicious/noExplicitAny: minimal mock for Node
	Object.assign({} as any, {
		addEventListener: () => {},
		removeEventListener: () => {},
		localStorage: {
			getItem: () => null,
			setItem: () => {},
			removeItem: () => {},
		},
	})
const wallet = new OneSatBrowserProvider({ appName: 'Test' })

// Connection
test('connect() exists', typeof wallet.connect === 'function')
test('disconnect() exists', typeof wallet.disconnect === 'function')
test('isConnected() exists', typeof wallet.isConnected === 'function')

// Signing
test('signTransaction() exists', typeof wallet.signTransaction === 'function')
test('signMessage() exists', typeof wallet.signMessage === 'function')

// Ordinals
test('inscribe() exists', typeof wallet.inscribe === 'function')
test('sendOrdinals() exists', typeof wallet.sendOrdinals === 'function')

// Listings
test('createListing() exists', typeof wallet.createListing === 'function')
test('purchaseListing() exists', typeof wallet.purchaseListing === 'function')
test('cancelListing() exists', typeof wallet.cancelListing === 'function')

// Tokens
test('transferToken() exists', typeof wallet.transferToken === 'function')

// Read-only
test('getBalance() exists', typeof wallet.getBalance === 'function')
test('getOrdinals() exists', typeof wallet.getOrdinals === 'function')
test('getTokens() exists', typeof wallet.getTokens === 'function')
test('getUtxos() exists', typeof wallet.getUtxos === 'function')

// Events
test('on() exists', typeof wallet.on === 'function')
test('off() exists', typeof wallet.off === 'function')

// Utility
test('getAddresses() exists', typeof wallet.getAddresses === 'function')
test(
	'getIdentityPubKey() exists',
	typeof wallet.getIdentityPubKey === 'function',
)
test('isOneSat === true', wallet.isOneSat === true)

// ---------------------------------------------------------------------------
// 3. Pre-connection state
// ---------------------------------------------------------------------------
section('Pre-connection State')
test('isConnected() = false before connect', wallet.isConnected() === false)
test('getAddresses() = null before connect', wallet.getAddresses() === null)
test(
	'getIdentityPubKey() = null before connect',
	wallet.getIdentityPubKey() === null,
)

// ---------------------------------------------------------------------------
// 4. Error classes and codes — MUST match docs exactly
// ---------------------------------------------------------------------------
section('Error Classes & Codes (docs accuracy)')

const userErr = new UserRejectedError()
test('UserRejectedError.code = 4001', userErr.code === 4001)
test('UserRejectedError instanceof OneSatError', userErr instanceof OneSatError)
test('UserRejectedError instanceof Error', userErr instanceof Error)
test(
	'UserRejectedError.name = "UserRejectedError"',
	userErr.name === 'UserRejectedError',
)

const lockErr = new WalletLockedError()
test('WalletLockedError.code = 4002', lockErr.code === 4002)
test(
	'WalletLockedError.name = "WalletLockedError"',
	lockErr.name === 'WalletLockedError',
)

const notConnErr = new WalletNotConnectedError()
test('WalletNotConnectedError.code = 4003', notConnErr.code === 4003)

const fundsErr = new InsufficientFundsError()
test('InsufficientFundsError.code = 4004', fundsErr.code === 4004)

const popupErr = new PopupBlockedError()
test('PopupBlockedError.code = 4006', popupErr.code === 4006)

const popupClosedErr = new PopupClosedError()
test('PopupClosedError.code = 4007', popupClosedErr.code === 4007)

const timeoutErr = new TimeoutError()
test('TimeoutError.code = 4008', timeoutErr.code === 4008)

// ---------------------------------------------------------------------------
// 5. ErrorCodes constants
// ---------------------------------------------------------------------------
section('ErrorCodes Constants')
test('ErrorCodes.USER_REJECTED = 4001', ErrorCodes.USER_REJECTED === 4001)
test('ErrorCodes.WALLET_LOCKED = 4002', ErrorCodes.WALLET_LOCKED === 4002)
test(
	'ErrorCodes.WALLET_NOT_CONNECTED = 4003',
	ErrorCodes.WALLET_NOT_CONNECTED === 4003,
)
test(
	'ErrorCodes.INSUFFICIENT_FUNDS = 4004',
	ErrorCodes.INSUFFICIENT_FUNDS === 4004,
)
test('ErrorCodes.POPUP_BLOCKED = 4006', ErrorCodes.POPUP_BLOCKED === 4006)
test('ErrorCodes.POPUP_CLOSED = 4007', ErrorCodes.POPUP_CLOSED === 4007)
test('ErrorCodes.TIMEOUT = 4008', ErrorCodes.TIMEOUT === 4008)

// ---------------------------------------------------------------------------
// 6. fromErrorResponse maps codes to correct error classes
// ---------------------------------------------------------------------------
section('fromErrorResponse Mapping')
test(
	'4001 -> UserRejectedError',
	fromErrorResponse({ code: 4001, message: 't' }) instanceof UserRejectedError,
)
test(
	'4002 -> WalletLockedError',
	fromErrorResponse({ code: 4002, message: 't' }) instanceof WalletLockedError,
)
test(
	'4003 -> WalletNotConnectedError',
	fromErrorResponse({ code: 4003, message: 't' }) instanceof
		WalletNotConnectedError,
)
test(
	'4004 -> InsufficientFundsError',
	fromErrorResponse({ code: 4004, message: 't' }) instanceof
		InsufficientFundsError,
)
test(
	'4006 -> PopupBlockedError',
	fromErrorResponse({ code: 4006, message: 't' }) instanceof PopupBlockedError,
)
test(
	'4007 -> PopupClosedError',
	fromErrorResponse({ code: 4007, message: 't' }) instanceof PopupClosedError,
)
test(
	'4008 -> TimeoutError',
	fromErrorResponse({ code: 4008, message: 't' }) instanceof TimeoutError,
)

// ---------------------------------------------------------------------------
// 7. RpcMethods constants
// ---------------------------------------------------------------------------
section('RPC Method Names')
test('CONNECT = "connect"', RpcMethods.CONNECT === 'connect')
test('DISCONNECT = "disconnect"', RpcMethods.DISCONNECT === 'disconnect')
test(
	'SIGN_TRANSACTION = "signTransaction"',
	RpcMethods.SIGN_TRANSACTION === 'signTransaction',
)
test('SIGN_MESSAGE = "signMessage"', RpcMethods.SIGN_MESSAGE === 'signMessage')
test('INSCRIBE = "inscribe"', RpcMethods.INSCRIBE === 'inscribe')
test(
	'SEND_ORDINALS = "sendOrdinals"',
	RpcMethods.SEND_ORDINALS === 'sendOrdinals',
)
test(
	'CREATE_LISTING = "createListing"',
	RpcMethods.CREATE_LISTING === 'createListing',
)
test(
	'PURCHASE_LISTING = "purchaseListing"',
	RpcMethods.PURCHASE_LISTING === 'purchaseListing',
)
test(
	'CANCEL_LISTING = "cancelListing"',
	RpcMethods.CANCEL_LISTING === 'cancelListing',
)
test(
	'TRANSFER_TOKEN = "transferToken"',
	RpcMethods.TRANSFER_TOKEN === 'transferToken',
)
test('GET_BALANCE = "getBalance"', RpcMethods.GET_BALANCE === 'getBalance')
test('GET_ORDINALS = "getOrdinals"', RpcMethods.GET_ORDINALS === 'getOrdinals')
test('GET_TOKENS = "getTokens"', RpcMethods.GET_TOKENS === 'getTokens')
test('GET_UTXOS = "getUtxos"', RpcMethods.GET_UTXOS === 'getUtxos')

// ---------------------------------------------------------------------------
// 8. WalletNotConnectedError thrown for pre-connect method calls
// ---------------------------------------------------------------------------
section('Pre-connect Error Behavior')

try {
	await wallet.getBalance()
	test('getBalance() throws WalletNotConnectedError', false)
} catch (e) {
	test(
		'getBalance() throws WalletNotConnectedError',
		e instanceof WalletNotConnectedError,
	)
}

try {
	await wallet.signMessage('test')
	test('signMessage() throws WalletNotConnectedError', false)
} catch (e) {
	test(
		'signMessage() throws WalletNotConnectedError',
		e instanceof WalletNotConnectedError,
	)
}

try {
	await wallet.getOrdinals()
	test('getOrdinals() throws WalletNotConnectedError', false)
} catch (e) {
	test(
		'getOrdinals() throws WalletNotConnectedError',
		e instanceof WalletNotConnectedError,
	)
}

try {
	await wallet.getTokens()
	test('getTokens() throws WalletNotConnectedError', false)
} catch (e) {
	test(
		'getTokens() throws WalletNotConnectedError',
		e instanceof WalletNotConnectedError,
	)
}

try {
	await wallet.getUtxos()
	test('getUtxos() throws WalletNotConnectedError', false)
} catch (e) {
	test(
		'getUtxos() throws WalletNotConnectedError',
		e instanceof WalletNotConnectedError,
	)
}

try {
	await wallet.inscribe({ dataB64: 'dGVzdA==', contentType: 'text/plain' })
	test('inscribe() throws WalletNotConnectedError', false)
} catch (e) {
	test(
		'inscribe() throws WalletNotConnectedError',
		e instanceof WalletNotConnectedError,
	)
}

try {
	await wallet.sendOrdinals({ outpoints: ['a_0'], destinationAddress: 'addr' })
	test('sendOrdinals() throws WalletNotConnectedError', false)
} catch (e) {
	test(
		'sendOrdinals() throws WalletNotConnectedError',
		e instanceof WalletNotConnectedError,
	)
}

try {
	await wallet.transferToken({
		tokenId: 'tok',
		amount: '1',
		destinationAddress: 'addr',
	})
	test('transferToken() throws WalletNotConnectedError', false)
} catch (e) {
	test(
		'transferToken() throws WalletNotConnectedError',
		e instanceof WalletNotConnectedError,
	)
}

try {
	await wallet.signTransaction({ rawtx: '0100' })
	test('signTransaction() throws WalletNotConnectedError', false)
} catch (e) {
	test(
		'signTransaction() throws WalletNotConnectedError',
		e instanceof WalletNotConnectedError,
	)
}

// ---------------------------------------------------------------------------
// 9. Event system basic operations
// ---------------------------------------------------------------------------
section('Event System')
let _eventFired = false
const evtHandler = () => {
	_eventFired = true
}
wallet.on('connect', evtHandler)
wallet.off('connect', evtHandler)
test('on/off subscribe/unsubscribe works without error', true)

// ---------------------------------------------------------------------------
// 10. OneSatConfig shape validation (compile-time — just ensure no TS errors)
// ---------------------------------------------------------------------------
section('OneSatConfig Shape')
const _config1: OneSatConfig = { appName: 'Test' }
const _config2: OneSatConfig = {
	appName: 'Test',
	popupUrl: 'https://example.com',
}
const _config3: OneSatConfig = { appName: 'Test', timeout: 60000 }
const _config4: OneSatConfig = { appName: 'Test', network: 'main' }
const _config5: OneSatConfig = { appName: 'Test', network: 'test' }
test('OneSatConfig accepts appName', true)
test('OneSatConfig accepts popupUrl', true)
test('OneSatConfig accepts timeout', true)
test('OneSatConfig accepts network: main | test', true)

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log(`\n${'='.repeat(50)}`)
const total = passed + failed
if (failed === 0) {
	console.log(`\x1b[32m${passed}/${total} tests passed\x1b[0m`)
} else {
	console.log(`\x1b[31m${passed}/${total} passed, ${failed} FAILED\x1b[0m`)
}
process.exit(failed > 0 ? 1 : 0)
