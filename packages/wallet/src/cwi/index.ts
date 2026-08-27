/**
 * CWI (Compute With Integrity) — BRC-100 WalletInterface senders + shared types
 */

export { ChromeCWI, createChromeCWI } from './chrome'
// Senders
export { CWI as EventCWI, createEventCWI } from './event'
export { type CWITransport, createCWI } from './factory'
export {
	createSigmaCWI,
	type SigmaCWIConfig,
	type SigmaCWIResult,
} from './sigma'
export {
	CWI_EVENT_NAMES,
	CWIEventName,
	type CWIRequest,
	type CWIRequestMessage,
	type CWIResponse,
	type CWIResponseDetail,
	type CWIResponseMessage,
	isCWIEventName,
} from './types'
export { createWebCWI, type WebCWIConfig, type WebCWIResult } from './web'
