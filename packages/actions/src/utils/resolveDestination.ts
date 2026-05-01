import type { Destination } from '@1sat/types'
import {
	LockingScript,
	P2PKH,
	PublicKey,
	type WalletProtocol,
} from '@bsv/sdk'
import type { OneSatContext } from '../types'

/**
 * Result of resolving a {@link Destination} into a concrete output spec.
 */
export interface ResolvedDestination {
	/** The locking script to set on the output. */
	lockingScript: LockingScript
	/**
	 * customInstructions metadata identifying how to derive the spending key
	 * for this output. Populated when the destination was wallet-derived
	 * (counterparty path, or default-to-self); omitted when the caller passed
	 * a literal lockingScript or a literal address — those callers track the
	 * spend path themselves.
	 */
	customInstructions?: {
		protocolID: WalletProtocol
		keyID: string
	}
}

export interface ResolveDestinationOptions {
	/** BRC-42 protocolID used when deriving keys for counterparty/self. */
	protocolID: WalletProtocol
	/** Prefix for the generated keyID — used for counterparty/self. */
	keyIDPrefix: string
}

/**
 * Resolve a {@link Destination} into a locking script and (when applicable)
 * the customInstructions needed for the wallet to spend the output later.
 *
 * Resolution priority — first set field wins:
 *   1. `lockingScript` — used verbatim (hex string or LockingScript object).
 *   2. `counterparty` — derive pubkey via wallet.getPublicKey, P2PKH-lock to it.
 *   3. `address` — literal P2PKH address.
 *   4. None set / `destination` undefined — default to `counterparty: 'self'`.
 */
export async function resolveDestination(
	ctx: OneSatContext,
	destination: Destination | undefined,
	opts: ResolveDestinationOptions,
): Promise<ResolvedDestination> {
	if (destination?.lockingScript !== undefined) {
		const ls =
			typeof destination.lockingScript === 'string'
				? LockingScript.fromHex(destination.lockingScript)
				: (destination.lockingScript as LockingScript)
		return { lockingScript: ls }
	}

	if (destination?.address !== undefined) {
		return {
			lockingScript: new P2PKH().lock(destination.address),
		}
	}

	// counterparty path — also covers the default (undefined → 'self').
	const counterparty = destination?.counterparty ?? 'self'
	const isSelf = counterparty === 'self'
	const keyID = `${opts.keyIDPrefix}-${Date.now()}`

	const { publicKey } = await ctx.wallet.getPublicKey({
		protocolID: opts.protocolID,
		keyID,
		counterparty: isSelf ? 'self' : counterparty,
		forSelf: isSelf,
	})
	const address = PublicKey.fromString(publicKey).toAddress()

	return {
		lockingScript: new P2PKH().lock(address),
		customInstructions: {
			protocolID: opts.protocolID,
			keyID,
		},
	}
}
