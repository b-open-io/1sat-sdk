import type { Destination } from '@1sat/types'
import {
	LockingScript,
	P2PKH,
	PublicKey,
	type WalletCounterparty,
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
	 *
	 * `counterparty` is included only when the destination was derived for a
	 * non-self counterparty. The downstream wallet that holds the matching
	 * shared key reads this back at spend time to invoke createSignature
	 * with the correct counterparty (BRC-29 symmetry). Self-derived outputs
	 * omit the field, and readers default to `'self'` for backward compatibility.
	 *
	 * Carries the optional `extra` map from `Destination.customInstructions`
	 * verbatim, so callers can record custom spend-time metadata (e.g.
	 * multi-sig template params) alongside the derived spending fields.
	 */
	customInstructions?: {
		protocolID: WalletProtocol
		keyID: string
		counterparty?: WalletCounterparty
		[extra: string]: unknown
	}
}

export interface ResolveDestinationOptions {
	/** BRC-42 protocolID used when deriving keys for counterparty/self. */
	protocolID: WalletProtocol
	/** Prefix for the generated keyID — used for counterparty/self. */
	keyIDPrefix: string
	/**
	 * Action id to derive the keyID from, so the derivation is recomputable
	 * from the action record. Callers should mint one with `randomActionId()`
	 * before building outputs and stamp it on the args via
	 * `buildActionIdLabel`, so `createTrackedAction` reuses the same value.
	 * Falls back to a wall-clock value, which is not recoverable.
	 */
	actionId?: string
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
		// Literal lockingScript path: the caller knows the spend semantics.
		// If they provided customInstructions, propagate them — but they
		// likely lack a wallet-derivation triple (protocolID/keyID), so we
		// only return the customInstructions block when the caller supplied
		// the required derivation fields. Otherwise downstream callers
		// (mintBsv21 etc.) decide how to emit minimal display metadata.
		if (destination.customInstructions) {
			const ci = destination.customInstructions as Record<string, unknown>
			const protocolID = ci.protocolID as WalletProtocol | undefined
			const keyID = ci.keyID as string | undefined
			if (protocolID && keyID) {
				const { protocolID: _p, keyID: _k, counterparty: _c, ...rest } = ci
				return {
					lockingScript: ls,
					customInstructions: {
						protocolID,
						keyID,
						...(ci.counterparty !== undefined && {
							counterparty: ci.counterparty as WalletCounterparty,
						}),
						...rest,
					},
				}
			}
		}
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
	const keyID = `${opts.keyIDPrefix}-${opts.actionId ?? Date.now()}`

	const { publicKey } = await ctx.wallet.getPublicKey({
		protocolID: opts.protocolID,
		keyID,
		counterparty: isSelf ? 'self' : counterparty,
		forSelf: isSelf,
	})
	const address = PublicKey.fromString(publicKey).toAddress()

	const extra = destination?.customInstructions ?? {}
	return {
		lockingScript: new P2PKH().lock(address),
		customInstructions: {
			protocolID: opts.protocolID,
			keyID,
			...(isSelf ? {} : { counterparty }),
			...extra,
		},
	}
}
