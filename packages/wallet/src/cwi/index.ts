/**
 * CWI (Compute With Integrity) — BRC-100 WalletInterface implementations
 *
 * Sender-side helpers produce a WalletInterface bound to a transport channel.
 * Receiver-side helpers bind a WalletInterface to a channel so other processes
 * can invoke it.
 */

export {
	CWIEventName,
	type CWIResponseDetail,
	type CWIRequest,
	type CWIResponse,
	type CWIRequestMessage,
	type CWIResponseMessage,
	CWI_EVENT_NAMES,
	isCWIEventName,
} from './types'

export { createCWI, type CWITransport } from './factory'

// Senders
export { createEventCWI, CWI as EventCWI } from './event'
export { createChromeCWI, ChromeCWI } from './chrome'
export { createWebCWI, type WebCWIConfig, type WebCWIResult } from './web'
export {
	createSigmaCWI,
	type SigmaCWIConfig,
	type SigmaCWIResult,
} from './sigma'

// Receivers
export { handleCWIRequest } from './receiver'
export {
	createChromeCWIReceiver,
	type ChromeCWIReceiver,
} from './chrome-receiver'
export {
	createWebCWIReceiver,
	type WebCWIReceiver,
	type WebCWIReceiverConfig,
} from './web-receiver'
export {
	createSigmaCWIReceiver,
	type SigmaCWIReceiver,
	type SigmaCWIReceiverConfig,
	type SigmaCustomMessage,
} from './sigma-receiver'
