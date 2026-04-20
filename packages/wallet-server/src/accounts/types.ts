/**
 * Identity key (secp256k1 public key, hex) of an account owner.
 * Acts as the primary key for accounts — 1:1 identity → account.
 */
export type IdentityKey = string

export interface Account {
	identityKey: IdentityKey
	createdAt: Date
	updatedAt: Date
}

export interface Payment {
	id: number
	identityKey: IdentityKey
	txid: string
	bytesCovered: number
	satsPaid: number
	paidThroughBlock: number
	appliedAt: Date
}

export interface NewPayment {
	identityKey: IdentityKey
	txid: string
	bytesCovered: number
	satsPaid: number
	paidThroughBlock: number
}

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

export interface PaymentQuote {
	satoshisRequired: number
	bytesRequested: number
	derivationPrefix: string
	orderID: string
	expiresAt: number
}

/**
 * Response shape of `GET /account/status`. When accounts metering is
 * disabled the capacity / pricing fields are omitted; callers should branch
 * on `accountsEnabled` to know which fields are present.
 */
export type AccountStatusResponse =
	| {
			identityKey: IdentityKey
			accountsEnabled: false
			currentBlock?: number
			usedBytes?: number
	  }
	| {
			identityKey: IdentityKey
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
	  }
