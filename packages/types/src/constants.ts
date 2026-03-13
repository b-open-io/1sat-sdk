/**
 * Shared constants for 1Sat Ordinals SDK
 */

// ============================================================================
// Protocol Identifiers
// ============================================================================

/** MAP (Magic Attribute Protocol) prefix address */
export const MAP_PREFIX = '1PuQa7K62MiKCtssSLKy1kh56WWU7MtUR5'

/** Ordinal inscription marker */
export const ORD_PREFIX = 'ord'

// ============================================================================
// Basket Names
// ============================================================================

export const FUNDING_BASKET = 'default'
export const ORDINALS_BASKET = '1sat'
export const BSV21_BASKET = 'bsv21'
export const OPNS_BASKET = 'opns'
export const LOCK_BASKET = 'lock'
export const SIGMA_BASKET = 'sigma'
export const BSOCIAL_BASKET = 'bsocial'
export const BAP_BASKET = 'bap'

// ============================================================================
// Fee Configuration
// ============================================================================

/** Default fee rate in satoshis per kilobyte */
export const DEFAULT_SAT_PER_KB = 10

/** Dust limit - minimum satoshis for a standard output */
export const DUST_LIMIT = 1

/** BSV21 per-output fee in satoshis */
export const BSV21_FEE_SATS = 1000

/** Minimum sats required to unlock certain scripts */
export const MIN_UNLOCK_SATS = 1500

// ============================================================================
// API Endpoints
// ============================================================================

/** 1Sat API host (mainnet) */
export const API_HOST = 'https://ordinals.gorillapool.io/api'

/** 1Sat API host (testnet) */
export const API_HOST_TESTNET = 'https://testnet.ordinals.gorillapool.io/api'

/** OrdFS host for inscription content */
export const ORDFS_HOST = 'https://ordfs.network'

/** WhatsOnChain API host (mainnet) */
export const WOC_MAINNET_URL = 'https://api.whatsonchain.com/v1/bsv/main'

/** WhatsOnChain API host (testnet) */
export const WOC_TESTNET_URL = 'https://api.whatsonchain.com/v1/bsv/test'

/** 1Sat API base URL (mainnet) */
export const ONESAT_MAINNET_URL = 'https://1sat.shruggr.cloud'

/** 1Sat API base URL (testnet) */
export const ONESAT_TESTNET_URL = 'https://testnet.api.1sat.app'

/** 1Sat API content URL (mainnet) */
export const ONESAT_MAINNET_CONTENT_URL = 'https://1sat.shruggr.cloud/content'

/** 1Sat API content URL (testnet) */
export const ONESAT_TESTNET_CONTENT_URL = 'https://testnet.api.1sat.app/content'

// ============================================================================
// Protocol IDs
// ============================================================================

export const ONESAT_PROTOCOL: [0 | 1 | 2, string] = [1, 'onesat']
export const MESSAGE_SIGNING_PROTOCOL: [0 | 1 | 2, string] = [
	1,
	'message signing',
]
export const BSV21_PROTOCOL: [0 | 1 | 2, string] = [1, 'bsv21']
export const BAP_PROTOCOL_ID: [0 | 1 | 2, string] = [1, 'bapid']
export const BAP_KEY_ID = 'identity'
export const BAP_BITCOM_ADDRESS = '1BAPSuaPnfGnSBM3GLV9yhxUdYe4vGbdMT'

// ============================================================================
// OrdLock Contract Scripts
// ============================================================================

/** OrdLock locking script prefix (hex) */
export const ORD_LOCK_PREFIX =
	'2097dfd76851bf465e8f715593b217714858bbe9570ff3bd5e33840a34e20ff0262102ba79df5f8ae7604a9830f03c7933028186aede0675a16f025dc4f8be8eec0382201008ce7480da41702918d1ec8e6849ba32b4d65b1e40dc669c31a1e6306b266c0000'

/** OrdLock locking script suffix (hex) */
export const ORD_LOCK_SUFFIX =
	'615179547a75537a537a537a0079537a75527a527a7575615579008763567901c161517957795779210ac407f0e4bd44bfc207355a778b046225a7068fc59ee7eda43ad905aadbffc800206c266b30e6a1319c66dc401e5bd6b432ba49688eecd118297041da8074ce081059795679615679aa0079610079517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e01007e81517a75615779567956795679567961537956795479577995939521414136d08c5ed2bf3ba048afe6dcaebafeffffffffffffffffffffffffffffff00517951796151795179970079009f63007952799367007968517a75517a75517a7561527a75517a517951795296a0630079527994527a75517a6853798277527982775379012080517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e01205279947f7754537993527993013051797e527e54797e58797e527e53797e52797e57797e0079517a75517a75517a75517a75517a75517a75517a75517a75517a75517a75517a75517a75517a756100795779ac517a75517a75517a75517a75517a75517a75517a75517a75517a7561517a75517a756169587951797e58797eaa577961007982775179517958947f7551790128947f77517a75517a75618777777777777777777767557951876351795779a9876957795779ac777777777777777767006868'

// ============================================================================
// Lock Template Scripts
// ============================================================================

export const LOCK_PREFIX =
	'2097dfd76851bf465e8f715593b217714858bbe9570ff3bd5e33840a34e20ff0262102ba79df5f8ae7604a9830f03c7933028186aede0675a16f025dc4f8be8eec0382201008ce7480da41702918d1ec8e6849ba32b4d65b1e40dc669c31a1e6306b266c0000'
export const LOCK_SUFFIX =
	'610079040065cd1d9f690079547a75537a537a537a5179537a75527a527a7575615579014161517957795779210ac407f0e4bd44bfc207355a778b046225a7068fc59ee7eda43ad905aadbffc800206c266b30e6a1319c66dc401e5bd6b432ba49688eecd118297041da8074ce081059795679615679aa0079610079517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e01007e81517a75615779567956795679567961537956795479577995939521414136d08c5ed2bf3ba048afe6dcaebafeffffffffffffffffffffffffffffff00517951796151795179970079009f63007952799367007968517a75517a75517a7561527a75517a517951795296a0630079527994527a75517a6853798277527982775379012080517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e01205279947f7754537993527993013051797e527e54797e58797e527e53797e52797e57797e0079517a75517a75517a75517a75517a75517a75517a75517a75517a75517a75517a75517a75517a756100795779ac517a75517a75517a75517a75517a75517a75517a75517a75517a7561517a75517a756169557961007961007982775179517954947f75517958947f77517a75517a756161007901007e81517a7561517a7561040065cd1d9f6955796100796100798277517951790128947f755179012c947f77517a75517a756161007901007e81517a7561517a756105ffffffff009f69557961007961007982775179517954947f75517958947f77517a75517a756161007901007e81517a7561517a75615279a2695679a95179876957795779ac7777777777777777'

// ============================================================================
// BSV21 Token Constants
// ============================================================================

/** HD public key for deriving BSV21 fee addresses */
export const BSV21_FEE_XPUB =
	'xpub661MyMwAqRbcF221R74MPqdipLsgUevAAX4hZP2rywyEeShpbe3v2r9ciAvSGT6FB22TEmFLdUyeEDJL4ekG8s9H5WXbzDQPr6eW1zEYYy9'

/** Maximum token supply (2^64 - 1) */
export const MAX_TOKEN_SUPPLY = 18446744073709551615n

// ============================================================================
// Content Types
// ============================================================================

/** BSV20/21 token inscription content type */
export const TOKEN_CONTENT_TYPE = 'application/bsv-20'

/** Supported image content types for icons */
export const IMAGE_CONTENT_TYPES = [
	'image/png',
	'image/jpeg',
	'image/gif',
	'image/svg+xml',
	'image/webp',
] as const

// ============================================================================
// BRC-29 Address Derivation
// ============================================================================

/** BRC-29 protocol ID — used by wallet-toolbox for key derivation and signing */
export const BRC29_PROTOCOL_ID: [0 | 1 | 2, string] = [2, '3241645161d8']

/**
 * Derivation info for a BRC-29 receive address.
 * Contains everything needed for internalizeAction's paymentRemittance.
 */
export interface AddressDerivation {
	/** The Bitcoin address (base58check) */
	address: string
	/** The key index (0, 1, 2, etc.) for internal lookups */
	index: number
	/** Base64-encoded derivation prefix (e.g., base64("yours")) */
	derivationPrefix: string
	/** Base64-encoded derivation suffix (4-byte big-endian index) */
	derivationSuffix: string
	/** The wallet's root identity public key */
	senderIdentityKey: string
	/** The derived public key for this address */
	publicKey: string
}

// ============================================================================
// Limits and caching
// ============================================================================

export const MAX_INSCRIPTION_BYTES = 100_000
export const EXCHANGE_RATE_CACHE_TTL = 5 * 60 * 1000
