/**
 * Destination — unified spec for the locking script of an output produced by
 * an action.
 *
 * Resolution priority:
 *   1. lockingScript — used verbatim. Caller is responsible for tracking how
 *      to spend the resulting output (no customInstructions are recorded).
 *   2. counterparty — wallet derives a P2PKH from the BRC-42 pubkey for that
 *      counterparty. customInstructions store the keyID for later spends.
 *   3. address — literal P2PKH address. No keyID is recorded; the wallet must
 *      already know how to spend the address (e.g. it's wallet-controlled), or
 *      the caller is sending value externally.
 *
 * If none of the three is set, actions default to counterparty: 'self' — the
 * output is locked to a wallet-derived self key.
 *
 * The string form of `lockingScript` is hex; the object form is the BSV SDK's
 * LockingScript instance. Hex keeps the type JSON-serializable for MCP /
 * registry callers; the object form preserves typing for programmatic use.
 */
export interface Destination {
	/** Pre-built locking script. Overrides counterparty/address. */
	lockingScript?: string | LockingScriptLike
	/** BRC-42 counterparty identity public key (hex). */
	counterparty?: string
	/** Literal P2PKH address. */
	address?: string
}

/**
 * Structural shape for a LockingScript instance — kept structural so this
 * package doesn't take a runtime dependency on @bsv/sdk. Consumers cast to
 * the real `LockingScript` from @bsv/sdk.
 */
export interface LockingScriptLike {
	toHex(): string
	toBinary(): number[]
}
