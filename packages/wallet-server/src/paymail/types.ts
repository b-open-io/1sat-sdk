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
	/**
	 * Presentation-only display name from PushDrop slot 1. The OpNS name is
	 * the unique, owned value; this is decoration and may be absent.
	 */
	profileName?: string
	/** Origin outpoint (`txid_vout`) of an image ordinal, from slot 2. */
	avatarOrigin?: string
}

/**
 * Backend that maps an alias to an identity for one domain. Returns null
 * when the alias does not resolve (404 at the route).
 */
export interface PaymailResolver {
	resolve(alias: string, domain: string): Promise<ResolvedBind | null>
}

export interface RegisteredUser {
	username: string
	identityKey: string
	createdAt: Date
}

/** Registry of user-registered names (the 1sat.app backend). */
export interface UserStore {
	get(alias: string): Promise<RegisteredUser | null>
	getByIdentity(identityKey: string): Promise<RegisteredUser | null>
	/**
	 * Idempotent per identity: re-claiming your own username succeeds, a
	 * username held by another identity throws.
	 */
	claim(username: string, identityKey: string): Promise<RegisteredUser>
}

export interface PaymailDeps {
	/** Public base URL for capability document (e.g. https://1sat.app) */
	baseUrl: string
	/** Stack root URL (OpNS, beef, tx broadcast) */
	stackUrl: string
	/**
	 * Domain resolved from the registered-users table instead of OpNS
	 * (e.g. 1sat.app). Unset = every domain resolves via OpNS.
	 */
	userDomain?: string
	/** Backing store for userDomain resolution. */
	userStore?: UserStore
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
