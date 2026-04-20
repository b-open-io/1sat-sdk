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
	/** Sats charged per GB of paid capacity per `durationBlocks`. */
	satsPerGb: number
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
