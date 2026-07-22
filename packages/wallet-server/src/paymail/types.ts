export interface PendingPayment {
	reference: string
	alias: string
	domain: string
	identityPubKey: string
	derivationPrefix: string
	derivationSuffix: string
	satoshis: number
	outputScript: string
	txid?: string
	createdAt: Date
	expiresAt: Date
}

export interface PendingStore {
	create(p: PendingPayment): Promise<void>
	get(reference: string): Promise<PendingPayment | null>
	update(p: PendingPayment): Promise<void>
	delete(reference: string): Promise<void>
}

export interface ResolvedBind {
	identityKey: string
	outpoint: string
}

export interface PaymailDeps {
	/** Public base URL for capability document (e.g. https://1sat.app) */
	baseUrl: string
	/** Stack root URL (OpNS, beef, tx broadcast) */
	stackUrl: string
	/** In-flight payment refs store */
	pendingStore: PendingStore
	/** Pending TTL ms (default 15m) */
	pendingTtlMs?: number
	/**
	 * Host wallet for subscription receipt checks + messagebox AuthFetch.
	 * Gate is on when requireEntitlement is true.
	 */
	hostWallet?: import('@bsv/sdk').WalletInterface
	requireEntitlement?: boolean
	/**
	 * Messagebox URL for payment_inbox delivery after receive.
	 * When unified with messagebox on the same app, point at this server's
	 * own public (or loopback) URL. Unset = skip delivery.
	 */
	messageboxUrl?: string
	/** Host private key for messagebox AuthFetch (required if messageboxUrl set) */
	hostPrivateKey?: import('@bsv/sdk').PrivateKey
}
