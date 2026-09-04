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
} from './types.js'

export { createCWI, type CWITransport } from './factory.js'

// Senders
export { createEventCWI, CWI as EventCWI } from './event.js'
export { createChromeCWI, ChromeCWI } from './chrome.js'
export { createWebCWI, type WebCWIConfig, type WebCWIResult } from './web.js'
export {
	createSigmaCWI,
	type SigmaCWIConfig,
	type SigmaCWIResult,
} from './sigma.js'
