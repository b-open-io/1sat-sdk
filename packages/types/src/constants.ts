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
// 1Sat asset baskets are P-prefixed so WalletPermissionsManager routes
// listOutputs / internalizeAction / etc. for them through the 1Sat
// permission module rather than through the generic basket-access flow.
// This:
//   - lets the 1Sat module gate access with its own UX
//   - avoids the double-encryption bug WPM has when a non-P basket is
//     internalized alongside a P-label
export const ORDINALS_BASKET = 'p 1sat ordinals'
export const BSV21_BASKET = 'p 1sat bsv21'
export const BSV21_AUTH_BASKET = 'p 1sat bsv21-auth'
export const BSV21_DEPLOY_FUNDING_BASKET = 'p 1sat bsv21-deploy-funding'
export const OPNS_BASKET = 'p 1sat opns'
export const LOCK_BASKET = 'p 1sat lock'
export const SIGMA_BASKET = 'p 1sat sigma'
export const BSOCIAL_BASKET = 'p 1sat bsocial'
// BAP records are 0-sat data outputs (identity registry), never externally
// spendable. They don't interact with the WPM double-encryption path so
// they stay non-P.
export const BAP_BASKET = 'bap'

/**
 * Holding basket for plain BSV received at the user's P1SAT-derived
 * deposit address. UTXOs land here via `internalizeBeef` and stay until
 * `sweepDeposit` rotates them into a fresh P1SAT-derived funding output
 * in {@link FUNDING_BASKET}. The basket name itself is the queue marker
 * — no separate tag is needed.
 */
export const DEPOSIT_BASKET = '1sat-deposit'

// ============================================================================
// Fee Configuration
// ============================================================================

/** Default fee rate in satoshis per kilobyte */
export const DEFAULT_SAT_PER_KB = 10

/** Dust limit - minimum satoshis for a standard output */
export const DUST_LIMIT = 1

/** BSV21 per-output fee in satoshis */
export const BSV21_FEE_SATS = 1000

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
export const ONESAT_MAINNET_URL = 'https://api.1sat.app'

/** 1Sat API base URL (testnet) */
export const ONESAT_TESTNET_URL = 'https://testnet.api.1sat.app'

/** 1Sat API content URL (mainnet) */
export const ONESAT_MAINNET_CONTENT_URL = 'https://api.1sat.app/content'

/** 1Sat API content URL (testnet) */
export const ONESAT_TESTNET_CONTENT_URL = 'https://testnet.api.1sat.app/content'

// ============================================================================
// Protocol IDs
// ============================================================================

/**
 * 1Sat ecosystem signing protocol. All 1Sat asset operations (ordinals,
 * BSV21, locks, OPNS, cosign, MNEE, deposits) sign and derive under this
 * protocol. The `'p '` prefix routes calls to the registered 1Sat permission
 * module per BRC-0098.
 */
export const P1SAT_PROTOCOL: [0 | 1 | 2, string] = [0, 'p 1sat']

/**
 * Generic dispatch-trigger label. Added by `createTrackedAction` when no
 * asset-specific labels are present, so the module still gets a chance
 * to capture the hashOutputs commitment for any 1Sat-asset createAction.
 *
 * Asset-specific labels (built via {@link buildInputAssetLabel} /
 * {@link buildOutputAssetLabel}) carry per-asset lookup keys the module
 * uses to render the prompt with rich detail (ordinal name, token amount,
 * etc.). The wallet-toolbox enforces a `'p <scheme> <payload>'` shape, so
 * a bare `'p 1sat'` is invalid; we use `'p 1sat action'` as the fallback.
 */
export const P1SAT_LABEL = 'p 1sat action'

/**
 * Label prefix recognized by the 1Sat permission module. Carries the
 * `'p 1sat'` dispatch trigger; payload is `'<basket> <id>'` — a lookup
 * key for the input asset's record in the wallet's storage.
 *
 * Outputs don't need a label: the SDK sets tags directly on
 * `args.outputs[i].tags` (unencrypted, visible to the module), and
 * `args.outputs[i].lockingScript` is cryptographically committed to
 * the final tx. The module reads both directly.
 */
export const P1SAT_INPUT_LABEL_PREFIX = 'p 1sat input '

/**
 * Build a label that points the 1Sat permission module at a specific
 * input asset record in the wallet's storage.
 *
 * `id` is the per-output asset id assigned by `createTrackedAction`
 * (`id:<actionId>_<vout>`) — the value stored on the input's `id:` tag,
 * without the `id:` prefix. The module resolves the record via
 * `listOutputs({ basket, tags: [id:<id>], tagQueryMode: 'all' })` — a
 * single indexed lookup, not a basket scan.
 *
 * Inputs without an `id:` tag (e.g. created before tracked-action ids
 * existed) can't be enriched; callers should skip emitting the label
 * for those rather than scanning by outpoint.
 *
 * @param basket - Basket the source output sits in (e.g. `'1sat'`).
 * @param id     - The asset id, i.e. the `id:` tag value on the input.
 */
export function buildInputAssetLabel(basket: string, id: string): string {
	return `${P1SAT_INPUT_LABEL_PREFIX}${basket} ${id}`
}

/**
 * BRC-111 P-label prefix used to tag actions with a BSV21 token id so the
 * wallet can filter transaction history per token via
 * `wallet.listActions({ labels: [...] })`. As a `'p 1sat '`-prefixed label
 * it routes through the 1Sat permission module instead of triggering the
 * wallet-toolbox's per-label Protocol Permission prompt.
 */
export const P1SAT_TOKEN_LABEL_PREFIX = 'p 1sat bsv21 '

/**
 * Build a BSV21 token label, e.g. `'p 1sat bsv21 <tokenId>'`.
 */
export function buildTokenLabel(tokenId: string): string {
	return `${P1SAT_TOKEN_LABEL_PREFIX}${tokenId}`
}

/**
 * Read the asset id (the `id:` tag value) off a wallet output's tags.
 * Returns `undefined` when the output predates per-output tracking ids
 * — in which case the caller should not emit an input asset label.
 */
export function readAssetIdTag(tags: string[] | undefined): string | undefined {
	if (!tags) return undefined
	for (const t of tags) {
		if (t.startsWith('id:')) return t.slice(3)
	}
	return undefined
}

/**
 * Placeholder marker prefix. SDK actions that need an AIP or Sigma
 * signature embedded in an output script append a single data push
 * containing one of:
 *
 *   '1SATPM:AIP'                          — needs AIP signature, current BAP key
 *   '1SATPM:AIP:<keyID>'                  — needs AIP signature, specific keyID
 *   '1SATPM:SIGMA:<targetVout>:<refVin>'  — needs Sigma signature, current BAP key
 *
 * The 1Sat permission module recognizes these markers in the output
 * script tail, removes them, and computes the real signature pushes via
 * the underlying wallet (bypassing the permission manager so no re-prompt).
 *
 * The explicit-keyID variant is needed for BAP chain operations:
 *   - publishIdentity uses keyID `identity-0` (root, predates current key)
 *   - rotateIdentity passes the outgoing keyID explicitly
 *   - attest / updateProfile (existing) omit keyID and resolve current
 */
export const P1SAT_PLACEHOLDER_PREFIX = '1SATPM:'
export const P1SAT_AIP_PLACEHOLDER = '1SATPM:AIP'
export const P1SAT_AIP_PLACEHOLDER_PREFIX = '1SATPM:AIP:'
export const P1SAT_SIGMA_PLACEHOLDER_PREFIX = '1SATPM:SIGMA:'

export const MESSAGE_SIGNING_PROTOCOL: [0 | 1 | 2, string] = [
	1,
	'message signing',
]

export const BAP_PROTOCOL_ID: [0 | 1 | 2, string] = [1, 'sigma']
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
