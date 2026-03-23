// CWI Wallet Injection Preload
// Runs inside every browser tab webview before page content loads.
// Injects window.CWI (BRC-100 wallet interface) so dApps can call wallet methods.

const WALLET_METHODS = [
	'createAction',
	'signAction',
	'abortAction',
	'listActions',
	'internalizeAction',
	'listOutputs',
	'relinquishOutput',
	'getPublicKey',
	'revealCounterpartyKeyLinkage',
	'revealSpecificKeyLinkage',
	'encrypt',
	'decrypt',
	'createHmac',
	'verifyHmac',
	'createSignature',
	'verifySignature',
	'acquireCertificate',
	'listCertificates',
	'proveCertificate',
	'relinquishCertificate',
	'discoverByIdentityKey',
	'discoverByAttributes',
	'isAuthenticated',
	'waitForAuthentication',
	'getHeight',
	'getHeaderForHeight',
	'getNetwork',
	'getVersion',
] as const

type WalletMethod = (typeof WALLET_METHODS)[number]

// Electrobun preload global — sends a message string to the host (parent) view.
// The host view receives it via the `host-message` event on the electrobun-webview element.
declare const __electrobunSendToHost: ((message: string) => void) | undefined

type PendingCall = {
	resolve: (value: unknown) => void
	reject: (reason: unknown) => void
}

// Map of in-flight request IDs to their promise callbacks
const pending = new Map<string, PendingCall>()

// Handle responses coming back from the host view via window messages.
// The host relays Bun RPC responses as: { type: 'cwi-response', id, result?, error? }
window.addEventListener('message', (e: MessageEvent) => {
	if (!e.data || typeof e.data !== 'object') return
	const { type, id, result, error } = e.data as {
		type: string
		id: string
		result?: unknown
		error?: string
	}
	if (type !== 'cwi-response') return
	const call = pending.get(id)
	if (!call) return
	pending.delete(id)
	if (error !== undefined) {
		call.reject(new Error(error))
	} else {
		call.resolve(result)
	}
})

function sendToHost(message: string): void {
	if (typeof __electrobunSendToHost === 'function') {
		__electrobunSendToHost(message)
	} else {
		// During development or in environments without Electrobun, log and no-op
		console.warn('[CWI preload] __electrobunSendToHost is not available')
	}
}

function buildMethod(method: WalletMethod) {
	return (args: unknown): Promise<unknown> => {
		return new Promise((resolve, reject) => {
			const id = crypto.randomUUID()
			pending.set(id, { resolve, reject })
			sendToHost(JSON.stringify({ type: 'cwi', id, method, args }))
		})
	}
}

// Attach window.CWI with all BRC-100 methods
const cwi: Record<string, (args: unknown) => Promise<unknown>> = {}
for (const method of WALLET_METHODS) {
	cwi[method] = buildMethod(method)
}

// Make it non-writable/non-configurable so pages cannot tamper with it
Object.defineProperty(window, 'CWI', {
	value: Object.freeze(cwi),
	writable: false,
	configurable: false,
	enumerable: true,
})
