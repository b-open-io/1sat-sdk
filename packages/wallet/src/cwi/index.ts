/**
 * CWI (Compute With Integrity) — BRC-100 WalletInterface senders + shared types
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
