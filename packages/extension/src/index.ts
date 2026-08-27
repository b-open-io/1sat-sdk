/**
 * @1sat/extension - Build browser wallet extensions
 *
 * This package provides the core primitives for building browser wallet
 * extensions that implement `window.onesat`.
 *
 * ## Quick Start
 *
 * ```typescript
 * // inject.ts
 * import { injectOneSatProvider } from '@1sat/extension'
 * injectOneSatProvider()
 *
 * // content.ts
 * import { createContentBridge } from '@1sat/extension'
 * createContentBridge()
 *
 * // background.ts
 * import { createBackgroundHandler, openApprovalPopup } from '@1sat/extension'
 *
 * const { broadcast } = createBackgroundHandler({
 *   handlers: {
 *     async connect(request, sender) {
 *       const approved = await openApprovalPopup('/popup/connect.html')
 *       if (!approved) throw new UserRejectedError()
 *       return { paymentAddress, ordinalAddress, identityPubKey }
 *     },
 *     // ... other handlers
 *   }
 * })
 * ```
 *
 * @packageDocumentation
 */

// ============================================================================
// Background Script
// ============================================================================
export {
	type BackgroundHandlerResult,
	createBackgroundHandler,
	keepAlive,
	openApprovalPopup,
} from './background'

// ============================================================================
// Content Script
// ============================================================================
export { CONTENT_SOURCE, createContentBridge, INJECT_SOURCE } from './content'
// ============================================================================
// Errors
// ============================================================================
export {
	DisconnectedError,
	fromExtensionError,
	InsufficientFundsError,
	InternalError,
	InvalidParamsError,
	InvalidTransactionError,
	MethodNotFoundError,
	OneSatExtensionError,
	toExtensionError,
	UnauthorizedError,
	UnsupportedMethodError,
	UserRejectedError,
	WalletLockedError,
	WalletNotConnectedError,
} from './errors'
// ============================================================================
// Inject Script
// ============================================================================
export { injectOneSatProvider } from './inject'
// Provider types (re-exported for convenience)
export type {
	BalanceResult,
	CancelListingRequest,
	ConnectResult,
	CreateListingRequest,
	EventHandler,
	InscribeRequest,
	InscribeResult,
	ListingResult,
	ListOptions,
	OneSatEvent,
	OneSatProvider,
	OrdinalOutput,
	PurchaseListingRequest,
	SendOrdinalsRequest,
	SendResult,
	SignMessageResult,
	SignTransactionRequest,
	SignTransactionResult,
	TokenOutput,
	TransferTokenRequest,
} from './provider-types'
// ============================================================================
// Types
// ============================================================================
export {
	type ApprovalData,
	type BackgroundHandlerConfig,
	type ConnectedSite,
	type ContentBridgeOptions,
	ErrorCode,
	type ErrorCodeValue,
	type ExtensionError,
	type ExtensionEvent,
	type ExtensionMessage,
	type ExtensionRequest,
	type ExtensionResponse,
	type Handler,
	type HandlerMap,
	type InitState,
	type InjectOptions,
	// Message types
	MessageType,
	// Type exports
	type MessageTypeValue,
	type RequestSender,
	RpcMethod,
	type RpcMethodValue,
	type Utxo,
	type WalletAddresses,
} from './types'
