/**
 * CWI (Compute With Integrity) - BRC-100 WalletInterface implementations
 *
 * Two implementations for different contexts:
 * - event.ts: For browser pages (uses CustomEvent, forwarded by content script)
 * - chrome.ts: For extension popup/options (uses chrome.runtime.sendMessage directly)
 */

export { CWIEventName, type CWIResponseDetail } from './types'
export { createCWI, type CWITransport } from './factory'
export { createEventCWI, CWI as EventCWI } from './event'
export { createChromeCWI, ChromeCWI } from './chrome'
export { createWebCWI, type WebCWIConfig, type WebCWIResult } from './web'
export {
	createSigmaCWI,
	type SigmaCWIConfig,
	type SigmaCWIResult,
} from './sigma'
