/**
 * Identity key (secp256k1 public key, hex) of an account owner.
 */
export type IdentityKey = string

export interface AccountsConfig {
	enabled: boolean
	/** Free baseline in bytes allocated to every account. */
	baselineBytes: number
	/**
	 * Capacity is purchased in chunks of this size. A deficit of any size
	 * rounds up to the next whole chunk; a single chunk's worth of capacity
	 * is added to the account. Defaults to 1 GB for production-style pricing;
	 * lower values (e.g. 1 KB) make dev-time testing cheap.
	 */
	purchaseUnitBytes: number
	/** Sats charged per purchase unit. */
	satsPerUnit: number
	/** How many blocks a payment remains valid for (~1 month at 10-min blocks = 4383). */
	durationBlocks: number
	/** Identity keys (hex pubkey) whose requests bypass metering. Server's own identity is auto-added. */
	freeIdentityKeys?: IdentityKey[]
}

/**
 * Pricing/capacity contract for the accounts layer. Wallet-server reads
 * config through this function on every billing check so deployments can
 * provide live values (e.g. file-watched, TTL-cached, or static).
 */
export type AccountsConfigProvider = () => AccountsConfig

/**
 * BRC-29 derivation the server expects on the next incoming payment. The
 * prefix is a constant; the suffix is the monotonic payment count for this
 * identity. Clients use these verbatim so the server can re-derive any
 * historical payment address later for audit.
 */
export interface NextPaymentDerivation {
	derivationPrefix: string
	derivationSuffix: string
}

/**
 * Registration facet of `GET /account/status`. `account` is present (and
 * possibly null) only when the host runs an account registry.
 */
export interface RegistrationStatus {
	registrationEnabled: boolean
	account?: {
		username: string
		displayName?: string
		avatarOrigin?: string
		createdAt: string
	} | null
}

/**
 * Response shape of `GET /account/status`. When accounts metering is
 * disabled the capacity / pricing fields are omitted; callers should branch
 * on `accountsEnabled` to know which fields are present. The registration
 * facet is always present.
 */
export type AccountStatusResponse = RegistrationStatus &
	(
		| {
				identityKey: IdentityKey
				serverIdentityKey: IdentityKey
				accountsEnabled: false
				currentBlock?: number
				usedBytes?: number
		  }
		| {
				identityKey: IdentityKey
				serverIdentityKey: IdentityKey
				accountsEnabled: true
				currentBlock: number
				usedBytes: number
				baselineBytes: number
				paidBytes: number
				capacityBytes: number
				deficitBytes: number
				paidThroughBlock: number | null
				pricing: {
					purchaseUnitBytes: number
					satsPerUnit: number
					durationBlocks: number
				}
				nextPayment: NextPaymentDerivation
		  }
	)
