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
// Inject Script
// ============================================================================
export { injectOneSatProvider } from './inject'

// ============================================================================
// Content Script
// ============================================================================
export { createContentBridge, INJECT_SOURCE, CONTENT_SOURCE } from './content'

// ============================================================================
// Background Script
// ============================================================================
export {
	createBackgroundHandler,
	openApprovalPopup,
	keepAlive,
	type BackgroundHandlerResult,
} from './background'

// ============================================================================
// Errors
// ============================================================================
export {
	OneSatExtensionError,
	UserRejectedError,
	UnauthorizedError,
	UnsupportedMethodError,
	DisconnectedError,
	InternalError,
	InvalidParamsError,
	MethodNotFoundError,
	toExtensionError,
	fromExtensionError,
} from './errors'

// ============================================================================
// Types
// ============================================================================
export {
	// Message types
	MessageType,
	RpcMethod,
	ErrorCode,
	// Type exports
	type MessageTypeValue,
	type RpcMethodValue,
	type ErrorCodeValue,
	type ExtensionRequest,
	type ExtensionResponse,
	type ExtensionEvent,
	type ExtensionMessage,
	type ExtensionError,
	type InjectOptions,
	type ContentBridgeOptions,
	type RequestSender,
	type Handler,
	type HandlerMap,
	type BackgroundHandlerConfig,
	type ApprovalData,
	type ConnectedSite,
	type WalletAddresses,
	type Utxo,
} from './types'

// Provider types (re-exported for convenience)
export type {
	OneSatProvider,
	OneSatEvent,
	EventHandler,
	ConnectResult,
	SignTransactionRequest,
	SignTransactionResult,
	SignMessageResult,
	InscribeRequest,
	InscribeResult,
	SendOrdinalsRequest,
	SendResult,
	CreateListingRequest,
	ListingResult,
	PurchaseListingRequest,
	CancelListingRequest,
	TransferTokenRequest,
	BalanceResult,
	OrdinalOutput,
	TokenOutput,
	ListOptions,
} from './provider-types'
