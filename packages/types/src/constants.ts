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
/** Tag on a single-CA deploy output; tokenId is the outpoint (`txid_vout`). */
export const BSV21_DEPLOY_TAG = 'bsv21:deploy'
export const OPNS_BASKET = 'p 1sat opns'
/**
 * Host-wallet basket for subscription receipt dust (1 sat to host).
 * Customer identity is **not** in the locking script — only wallet-local tags.
 */
export const HOSTING_BASKET = 'p 1sat hosting'
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

// ============================================================================
// OpNS identity bind (PushDrop on name UTXO)
// ============================================================================

/** customInstructions.template when the name is locked with signed PushDrop */
export const OPNS_PUSHDROP_TEMPLATE = 'pushdrop'

/** keyID prefix: full id is `opns:{txid}_{vout}` of the input spent to create the bind */
export const OPNS_REGISTER_KEY_PREFIX = 'opns:'

/** Counterparty for bind lock + field-sig */
export const OPNS_REGISTER_COUNTERPARTY = 'anyone' as const

/** Wallet tag on a published (bound) OpNS name */
export const OPNS_PUBLISHED_TAG = 'opns:published'

/** PushDrop keyID from spent input outpoint (`txid.vout` → `opns:{txid}_{vout}`) */
export function opnsRegisterKeyId(outpoint: string): string {
	const [txid, vout] = outpoint.split('.')
	return `${OPNS_REGISTER_KEY_PREFIX}${txid}_${vout}`
}

// ============================================================================
// Host subscription receipts (wallet-local tags only — not on-chain identity)
// ============================================================================

/** Tag: `payer:{identityKeyHex}` on host receipt outputs (storage only). */
export const HOSTING_PAYER_TAG_PREFIX = 'payer:'

/** Tag: `exp:{unixSeconds}` on host receipt outputs (storage only). */
export const HOSTING_EXP_TAG_PREFIX = 'exp:'

export function hostingPayerTag(identityKeyHex: string): string {
	return `${HOSTING_PAYER_TAG_PREFIX}${identityKeyHex}`
}

export function hostingExpTag(expiresAtUnix: number): string {
	return `${HOSTING_EXP_TAG_PREFIX}${Math.floor(expiresAtUnix)}`
}

export function readHostingPayer(
	tags: string[] | undefined,
): string | undefined {
	if (!tags) return undefined
	for (const t of tags) {
		if (t.startsWith(HOSTING_PAYER_TAG_PREFIX)) {
			return t.slice(HOSTING_PAYER_TAG_PREFIX.length)
		}
	}
	return undefined
}

export function readHostingExp(tags: string[] | undefined): number | undefined {
	if (!tags) return undefined
	for (const t of tags) {
		if (!t.startsWith(HOSTING_EXP_TAG_PREFIX)) continue
		const n = Number(t.slice(HOSTING_EXP_TAG_PREFIX.length))
		if (Number.isFinite(n)) return n
	}
	return undefined
}

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
 * Intent label prefix. Payload is `<domain>.<verb>` (e.g. `opns.register`).
 * When present, replaces the need for bare {@link P1SAT_LABEL} as the
 * WPM dispatch trigger for createAction.
 */
export const P1SAT_INTENT_LABEL_PREFIX = 'p 1sat intent '

/** Well-known P1Sat createAction intents (permission apply dispatch keys). */
export const P1SAT_INTENTS = {
	OPNS_REGISTER: 'opns.register',
	OPNS_DEREGISTER: 'opns.deregister',
	OPNS_LIST: 'opns.list',
	OPNS_TRANSFER: 'opns.transfer',
	OPNS_CANCEL_LISTING: 'opns.cancel-listing',
	OPNS_PURCHASE: 'opns.purchase',
	ORDINAL_TRANSFER: 'ordinal.transfer',
	ORDINAL_LIST: 'ordinal.list',
	ORDINAL_CANCEL_LISTING: 'ordinal.cancel-listing',
	ORDINAL_PURCHASE: 'ordinal.purchase',
	ORDINAL_BURN: 'ordinal.burn',
	ORDINAL_INSCRIBE: 'ordinal.inscribe',
	ORDINAL_INSCRIBE_SIGMA: 'ordinal.inscribe-sigma',
	ORDFS_DEPLOY: 'ordfs.deploy',
	ORDFS_DEPLOY_SIGMA: 'ordfs.deploy-sigma',
	ORDINAL_MINT_COLLECTION: 'ordinal.mint-collection',
	ORDINAL_MINT_ITEM: 'ordinal.mint-item',
	LOCK_LOCK: 'lock.lock',
	LOCK_UNLOCK: 'lock.unlock',
	BSV21_TRANSFER: 'bsv21.transfer',
	BSV21_PURCHASE: 'bsv21.purchase',
	BSV21_MINT: 'bsv21.mint',
	BSV21_DEPLOY: 'bsv21.deploy',
	BSV21_DEPLOY_SIGMA: 'bsv21.deploy-sigma',
} as const

export type P1SatIntent = (typeof P1SAT_INTENTS)[keyof typeof P1SAT_INTENTS]

/** All known intent id strings (for fail-closed checks). */
export const P1SAT_INTENT_IDS: ReadonlySet<string> = new Set(
	Object.values(P1SAT_INTENTS),
)

/**
 * True if `intent` is a known P1Sat intent id.
 */
export function isKnownP1SatIntent(intent: string): intent is P1SatIntent {
	return P1SAT_INTENT_IDS.has(intent)
}

/**
 * Build `p 1sat intent <domain>.<verb>`.
 */
export function buildIntentLabel(intent: string): string {
	return `${P1SAT_INTENT_LABEL_PREFIX}${intent}`
}

/**
 * First `p 1sat intent …` label payload, or undefined.
 */
export function parseIntentLabel(
	labels: string[] | undefined,
): string | undefined {
	if (!labels) return undefined
	for (const label of labels) {
		if (!label.startsWith(P1SAT_INTENT_LABEL_PREFIX)) continue
		const intent = label.slice(P1SAT_INTENT_LABEL_PREFIX.length).trim()
		if (intent) return intent
	}
	return undefined
}

/**
 * Action-id label prefix. Payload is the hex actionId that also appears in
 * each basketed output's `id:<actionId>_<index>` tag.
 *
 * The actionId is the action's correlator: it is stamped before apply runs,
 * so both the action and apply can derive the same intermediate keyIDs
 * (e.g. the Sigma anchor) without passing anything between them. Nothing may
 * travel back from apply to the action — `WalletPermissionsManager` rebuilds
 * `labels` into a new array before the module sees the args, so writes there
 * are not visible to the caller.
 */
export const P1SAT_ACTION_ID_LABEL_PREFIX = 'p 1sat action-id '

/**
 * Build `p 1sat action-id <actionId>`.
 */
export function buildActionIdLabel(actionId: string): string {
	return `${P1SAT_ACTION_ID_LABEL_PREFIX}${actionId}`
}

/**
 * First `p 1sat action-id …` label payload, or undefined.
 */
export function parseActionIdLabel(
	labels: string[] | undefined,
): string | undefined {
	if (!labels) return undefined
	for (const label of labels) {
		if (!label.startsWith(P1SAT_ACTION_ID_LABEL_PREFIX)) continue
		const actionId = label.slice(P1SAT_ACTION_ID_LABEL_PREFIX.length).trim()
		if (actionId) return actionId
	}
	return undefined
}

/**
 * True if labels already route createAction to the 1Sat permission module
 * (bare action label or any intent label).
 */
export function hasP1SatDispatchLabel(labels: string[] | undefined): boolean {
	if (!labels?.length) return false
	if (labels.includes(P1SAT_LABEL)) return true
	return labels.some((l) => l.startsWith(P1SAT_INTENT_LABEL_PREFIX))
}

/**
 * Shared `'p 1sat '` prefix on every 1Sat asset basket. Used by the
 * WalletPermissionsManager to route basket-scoped calls (listOutputs,
 * internalizeAction, etc.) through the 1Sat permission module.
 */
export const P1SAT_BASKET_PREFIX = 'p 1sat '

/**
 * Label prefix recognized by the 1Sat permission module. Carries the
 * `'p 1sat'` dispatch trigger; payload is `'<basket-suffix> <id>'`
 * where `<basket-suffix>` is the asset basket name with the shared
 * `'p 1sat '` prefix stripped (e.g. `'ordinals'`, `'bsv21'`). Encoding
 * only the suffix keeps the payload space-free so the parser can split
 * cleanly on the boundary between basket and id.
 *
 * Outputs don't need a label: the SDK sets tags directly on
 * `args.outputs[i].tags` (unencrypted, visible to the module), and
 * `args.outputs[i].lockingScript` is cryptographically committed to
 * the final tx. The module reads both directly.
 */
export const P1SAT_INPUT_LABEL_PREFIX = 'p 1sat input '

/**
 * Byte length of the zero-filled signature field carried by an unsealed
 * `opns.register` lock. The action emits the complete PushDrop script with
 * this field zeroed so the output is exactly the size it will be on chain;
 * apply replaces it with the real DER signature. Sized to the longest DER
 * signature so the estimate is never short.
 */
export const OPNS_REGISTER_SIG_PLACEHOLDER_LEN = 72

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
 * The shared {@link P1SAT_BASKET_PREFIX} is stripped from the basket
 * before encoding so basket names with embedded spaces don't collide
 * with the basket↔id space delimiter. Non-P1Sat baskets pass through
 * unstripped — those won't resolve in the permission module and the
 * input simply drops from enrichment (graceful degradation to the
 * generic transaction approval UI).
 *
 * @param basket - Asset basket (typically a P1Sat basket constant).
 * @param id     - The asset id, i.e. the `id:` tag value on the input.
 */
export function buildInputAssetLabel(basket: string, id: string): string {
	const suffix = basket.startsWith(P1SAT_BASKET_PREFIX)
		? basket.slice(P1SAT_BASKET_PREFIX.length)
		: basket
	return `${P1SAT_INPUT_LABEL_PREFIX}${suffix} ${id}`
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
// OpNS Contract Scripts
// ============================================================================

/** OpNS covenant locking script (compiled sCrypt contract, prepended to the
 * stateful OP_RETURN trailer by OpNS.lock) */
export const OPNS_CONTRACT =
	'0168016a2097dfd76851bf465e8f715593b217714858bbe9570ff3bd5e33840a34e20ff0262102ba79df5f8ae7604a9830f03c7933028186aede0675a16f025dc4f8be8eec0382201008ce7480da41702918d1ec8e6849ba32b4d65b1e40dc669c31a1e6306b266c00000000000000000116615179597a75587a587a587a587a587a587a587a587a0079587a75577a577a577a577a577a577a577a00577a75567a567a567a567a567a567a00567a75557a557a557a557a557a00557a75547a547a547a547a00547a75537a537a537a7575615c7961007901687f776100005279517f75007f77007901fd87635379537f75517f7761007901007e81517a7561537a75527a527a5379535479937f75537f77527a75517a67007901fe87635379557f75517f7761007901007e81517a7561537a75527a527a5379555479937f75557f77527a75517a67007901ff87635379597f75517f7761007901007e81517a7561537a75527a527a5379595479937f75597f77527a75517a675379517f75007f7761007901007e81517a7561537a75527a527a5379515479937f75517f77527a75517a6868685179517a75517a75517a75517a7561517a7561007961007982775179517951947f755179549451947f77007981527951799454945194517a75517a75517a75517a7561517951797f75537a75527a527a0000537953797f77610079537a75527a527a00527a75517a7561615179517951937f7551797f775179768b537a75527a527a75010051798791517a75610079916361005379005179557951937f7555797f77815579768b577a75567a567a567a567a567a567a750079014c9f630079547a75537a537a537a527956795579937f7556797f77527a75517a670079014c9c635279567951937f7556797f7761007901007e81517a7561547a75537a537a537a55795193567a75557a557a557a557a557a557975527956795579937f7556797f77527a75517a670079014d9c635279567952937f7556797f7761007901007e81517a7561547a75537a537a537a55795293567a75557a557a557a557a557a557975527956795579937f7556797f77527a75517a670079014e9c635279567954937f7556797f7761007901007e81517a7561547a75537a537a537a55795493567a75557a557a557a557a557a557975527956795579937f7556797f77527a75517a670069686868685579547993567a75557a557a557a557a557a5579755179517a75517a75517a75517a75615a7a75597a597a597a597a597a597a597a597a597a6161005379005179557951937f7555797f77815579768b577a75567a567a567a567a567a567a750079014c9f630079547a75537a537a537a527956795579937f7556797f77527a75517a670079014c9c635279567951937f7556797f7761007901007e81517a7561547a75537a537a537a55795193567a75557a557a557a557a557a557975527956795579937f7556797f77527a75517a670079014d9c635279567952937f7556797f7761007901007e81517a7561547a75537a537a537a55795293567a75557a557a557a557a557a557975527956795579937f7556797f77527a75517a670079014e9c635279567954937f7556797f7761007901007e81517a7561547a75537a537a537a55795493567a75557a557a557a557a557a557975527956795579937f7556797f77527a75517a670069686868685579547993567a75557a557a557a557a557a5579755179517a75517a75517a75517a75618161597a75587a587a587a587a587a587a587a587a61005379005179557951937f7555797f77815579768b577a75567a567a567a567a567a567a750079014c9f630079547a75537a537a537a527956795579937f7556797f77527a75517a670079014c9c635279567951937f7556797f7761007901007e81517a7561547a75537a537a537a55795193567a75557a557a557a557a557a557975527956795579937f7556797f77527a75517a670079014d9c635279567952937f7556797f7761007901007e81517a7561547a75537a537a537a55795293567a75557a557a557a557a557a557975527956795579937f7556797f77527a75517a670079014e9c635279567954937f7556797f7761007901007e81517a7561547a75537a537a537a55795493567a75557a557a557a557a557a557975527956795579937f7556797f77527a75517a670069686868685579547993567a75557a557a557a557a557a5579755179517a75517a75517a75517a7561587a75577a577a577a577a577a577a577a61005379005179557951937f7555797f77815579768b577a75567a567a567a567a567a567a750079014c9f630079547a75537a537a537a527956795579937f7556797f77527a75517a670079014c9c635279567951937f7556797f7761007901007e81517a7561547a75537a537a537a55795193567a75557a557a557a557a557a557975527956795579937f7556797f77527a75517a670079014d9c635279567952937f7556797f7761007901007e81517a7561547a75537a537a537a55795293567a75557a557a557a557a557a557975527956795579937f7556797f77527a75517a670079014e9c635279567954937f7556797f7761007901007e81517a7561547a75537a537a537a55795493567a75557a557a557a557a557a557975527956795579937f7556797f77527a75517a670069686868685579547993567a75557a557a557a557a557a5579755179517a75517a75517a75517a7561577a75567a567a567a567a567a567a6801117901c1615179011179011179210ac407f0e4bd44bfc207355a778b046225a7068fc59ee7eda43ad905aadbffc800206c266b30e6a1319c66dc401e5bd6b432ba49688eecd118297041da8074ce08100113795679615679aa0079610079517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e01007e81517a75615779567956795679567961537956795479577995939521414136d08c5ed2bf3ba048afe6dcaebafeffffffffffffffffffffffffffffff00517951796151795179970079009f63007952799367007968517a75517a75517a7561527a75517a517951795296a0630079527994527a75517a6853798277527982775379012080517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e01205279947f7754537993527993013051797e527e54797e58797e527e53797e52797e57797e0079517a75517a75517a75517a75517a75517a75517a75517a75517a75517a75517a75517a75517a756100795779ac517a75517a75517a75517a75517a75517a75517a75517a75517a7561517a75517a75616959798277009c6301117961007901687f7501447f77517a756101207f75007f7701127961007901687f7501447f77517a756101207f778154807e5a7a75597a597a597a597a597a597a597a597a597a6801157901157961587952797e51797eaa007961007901007e81517a75610200015f799461007900a269517951796100517958968002010052795897987e81517a7561965179009c63527967527952974f9c6300795194675279009f630079009c670068634f670079686868517a75517a75517a75610079009c695179517a75517a75517a75517a7561577a75567a567a567a567a567a567a011579610079012d9c6400790130a2630079013a9f6700686751686400790161a2630079017b9f67006867516800796951527961007900a269517951796100517958968002010052795897987e81517a756195517a75517a75610079825d79827ba4766b807c6c808481009c695b79517993517a75517a75517a7561597a75587a587a587a587a587a587a587a587a51616100610079635167010068517a75615b796100798277005179014c9f63517951615179517951938000795179827751947f75007f77517a75517a75517a7561517a756751790200019f63014c527951615179517951938000795179827751947f75007f77517a75517a75517a75617e517a75675179030000019f63014d527952615179517951938000795179827751947f75007f77517a75517a75517a75617e517a756751790500000000019f63014e527954615179517951938000795179827751947f75007f77517a75517a75517a75617e517a7567006968686868007953797e517a75517a75517a75617e5a79610079009c630100670079686100798277005179014c9f63517951615179517951938000795179827751947f75007f77517a75517a75517a7561517a756751790200019f63014c527951615179517951938000795179827751947f75007f77517a75517a75517a75617e517a75675179030000019f63014d527952615179517951938000795179827751947f75007f77517a75517a75517a75617e517a756751790500000000019f63014e527954615179517951938000795179827751947f75007f77517a75517a75517a75617e517a7567006968686868007953797e517a75517a75517a7561517a75617e59796100798277005179014c9f63517951615179517951938000795179827751947f75007f77517a75517a75517a7561517a756751790200019f63014c527951615179517951938000795179827751947f75007f77517a75517a75517a75617e517a75675179030000019f63014d527952615179517951938000795179827751947f75007f77517a75517a75517a75617e517a756751790500000000019f63014e527954615179517951938000795179827751947f75007f77517a75517a75517a75617e517a7567006968686868007953797e517a75517a75517a75617e58796100798277005179014c9f63517951615179517951938000795179827751947f75007f77517a75517a75517a7561517a756751790200019f63014c527951615179517951938000795179827751947f75007f77517a75517a75517a75617e517a75675179030000019f63014d527952615179517951938000795179827751947f75007f77517a75517a75517a75617e517a756751790500000000019f63014e527954615179517951938000795179827751947f75007f77517a75517a75517a75617e517a7567006968686868007953797e517a75517a75517a75617e5779517961007982775480517951797e0051807e517a75517a75617e517a75610079527961007958805279610079827700517902fd009f63517951615179517951938000795179827751947f75007f77517a75517a75517a7561517a75675179030000019f6301fd527952615179517951938000795179827751947f75007f77517a75517a75517a75617e517a756751790500000000019f6301fe527954615179517951938000795179827751947f75007f77517a75517a75517a75617e517a75675179090000000000000000019f6301ff527958615179517951938000795179827751947f75007f77517a75517a75517a75617e517a7568686868007953797e517a75517a75517a75617e517a75517a7561517a75517a7561005a7a75597a597a597a597a597a597a597a597a597a58790117797e597a75587a587a587a587a587a587a587a587a51616100610079635167010068517a75615c796100798277005179014c9f63517951615179517951938000795179827751947f75007f77517a75517a75517a7561517a756751790200019f63014c527951615179517951938000795179827751947f75007f77517a75517a75517a75617e517a75675179030000019f63014d527952615179517951938000795179827751947f75007f77517a75517a75517a75617e517a756751790500000000019f63014e527954615179517951938000795179827751947f75007f77517a75517a75517a75617e517a7567006968686868007953797e517a75517a75517a75617e5b79610079009c630100670079686100798277005179014c9f63517951615179517951938000795179827751947f75007f77517a75517a75517a7561517a756751790200019f63014c527951615179517951938000795179827751947f75007f77517a75517a75517a75617e517a75675179030000019f63014d527952615179517951938000795179827751947f75007f77517a75517a75517a75617e517a756751790500000000019f63014e527954615179517951938000795179827751947f75007f77517a75517a75517a75617e517a7567006968686868007953797e517a75517a75517a7561517a75617e5a796100798277005179014c9f63517951615179517951938000795179827751947f75007f77517a75517a75517a7561517a756751790200019f63014c527951615179517951938000795179827751947f75007f77517a75517a75517a75617e517a75675179030000019f63014d527952615179517951938000795179827751947f75007f77517a75517a75517a75617e517a756751790500000000019f63014e527954615179517951938000795179827751947f75007f77517a75517a75517a75617e517a7567006968686868007953797e517a75517a75517a75617e59796100798277005179014c9f63517951615179517951938000795179827751947f75007f77517a75517a75517a7561517a756751790200019f63014c527951615179517951938000795179827751947f75007f77517a75517a75517a75617e517a75675179030000019f63014d527952615179517951938000795179827751947f75007f77517a75517a75517a75617e517a756751790500000000019f63014e527954615179517951938000795179827751947f75007f77517a75517a75517a75617e517a7567006968686868007953797e517a75517a75517a75617e5879517961007982775480517951797e0051807e517a75517a75617e517a75610079527961007958805279610079827700517902fd009f63517951615179517951938000795179827751947f75007f77517a75517a75517a7561517a75675179030000019f6301fd527952615179517951938000795179827751947f75007f77517a75517a75517a75617e517a756751790500000000019f6301fe527954615179517951938000795179827751947f75007f77517a75517a75517a75617e517a75675179090000000000000000019f6301ff527958615179517951938000795179827751947f75007f77517a75517a75517a75617e517a7568686868007953797e517a75517a75517a75617e517a75517a7561517a75517a7561011579615a795f79827700a0635b79012e7e60797e517a756851791a0063036f726451116170706c69636174696f6e2f6f702d6e73007e517982777e51797e0115797e0114797e01217e21316f704e53554a56624263325666384c464e536f797747474b346a4d63475672437e01247e5e797e517a75517a75615161007958805279610079827700517902fd009f63517951615179517951938000795179827751947f75007f77517a75517a75517a7561517a75675179030000019f6301fd527952615179517951938000795179827751947f75007f77517a75517a75517a75617e517a756751790500000000019f6301fe527954615179517951938000795179827751947f75007f77517a75517a75517a75617e517a75675179090000000000000000019f6301ff527958615179517951938000795179827751947f75007f77517a75517a75517a75617e517a7568686868007953797e517a75517a75517a75617e517a75517a7561527952797e51797e0116797e0079aa01167961007982775179517958947f7551790128947f77517a75517a7561877777777777777777777777777777777777777777777777777777'

/** OpNS genesis outpoint bytes (32-byte LE txid + 4-byte LE vout) embedded in
 * every node's state */
export const OPNS_GENESIS =
	'25cb9c17772641ba2374a8d74f729aad921932fef5e2c76642f279a38e55b75800000000'

/** OpNS proof-of-work difficulty: leading zero bits of the reversed sha256d */
export const OPNS_DIFFICULTY = 22

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

/**
 * Maximum content body size (bytes) for a single-transaction inscription
 * (non-stream path). Above this, callers must opt into OrdFS streaming.
 */
export const MAX_INSCRIPTION_BYTES = 50 * 1024 * 1024
export const EXCHANGE_RATE_CACHE_TTL = 5 * 60 * 1000

// ============================================================================
// OrdFS streaming (multi-tx inscription chains)
// ============================================================================

/**
 * Default size of each stream chunk body (bytes), not including script overhead.
 * 1 MiB balances tx count vs size. Override via streamChunkSize when streaming.
 */
export const DEFAULT_STREAM_CHUNK_SIZE = 1024 * 1024
/** Content type for stream chunks after the origin */
export const ORDFS_STREAM_CONTENT_TYPE = 'ordfs/stream'
/** Media-type parameter on the origin chunk (e.g. `video/mp4; stream=ordfs`) */
export const ORDFS_STREAM_PARAM = 'stream=ordfs'
