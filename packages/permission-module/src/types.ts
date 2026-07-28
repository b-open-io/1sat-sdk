import type { IPermissionStore } from '@1sat/wallet'
import type { WalletInterface } from '@bsv/sdk'

/**
 * Default commitment cache TTL (seconds). After this window the captured
 * hashOutputs commitment expires and any subsequent createSignature for
 * the same originator will be treated as standalone (re-prompt) instead
 * of auto-granted.
 *
 * Configurable per-module-instance via factory args.
 */
export const DEFAULT_COMMITMENT_TTL_SECONDS = 60

/** A single captured commitment from a createAction approval. */
export interface CapturedCommitment {
	/** BIP-143 hashOutputs (32 bytes, hex) of the approved transaction. */
	hashOutputs: string
	/** `txid.vout` strings for every input the user authorized. */
	authorizedOutpoints: Set<string>
	/** Wall-clock ms when the user approved. */
	approvedAt: number
	/** WalletPermissionsManager reference returned from createAction. */
	reference: string
}

/** Kinds of prompts the module asks the host wallet to show. */
export type PromptKind = 'transaction' | 'signature' | 'protocol' | 'basketAccess'

/**
 * Structured request handed to the wallet's promptHandler.
 *
 * The host wallet renders this via `@1sat/permission-module-ui`'s component
 * (or its own UI) and resolves the returned Promise with `true` (approve)
 * or `false` (reject).
 */
export interface PromptRequest {
	kind: PromptKind
	originator: string
	/**
	 * Context payload for the host UI.
	 *
	 * Transaction kind (typical fields the UI consumes):
	 * - `p1satIntent` — e.g. `opns.register`, `ordinal.transfer`
	 * - `inputs` / `outputs` / `contentUrls` — assets, recipients, ORDFS/icon URLs
	 * - `trust?` — `{ state: 'verified'|'unverified'|'mismatch', note? }` purchases
	 * - `indexerFeeSats?` / `indexerFeeNote?` — overlay fee (not miner/DSAP)
	 *
	 * For `kind: 'basketAccess'`: `{ baskets: BasketAccessRequest[] }`.
	 */
	intent: Record<string, unknown>
	/** Short human-readable summary line. Filled in by the module. */
	summary: string
}

/**
 * One basket the dApp wants access to, surfaced inside the
 * `kind: 'basketAccess'` prompt intent.
 */
export interface BasketAccessRequest {
	basket: string
	description?: string
}

/**
 * Callback the host wallet provides for showing prompts and awaiting
 * the user's decision.
 */
export type PromptHandler = (request: PromptRequest) => Promise<boolean>

/**
 * The slice of `OneSatServices` the module uses to verify card facts.
 *
 * Structural rather than a direct `@1sat/client` import, so hosts can pass
 * their real `OneSatServices` (which satisfies this) without the module taking
 * a hard dependency on the client package. Every member is optional — a host
 * may wire up only what it has.
 */
export interface VerificationServices {
	ordfs?: {
		bulkMetadata?(
			outpoints: string[],
		): Promise<Record<string, { contentType?: string; contentLength?: number; origin?: string; map?: Record<string, unknown> } | null>>
		/**
		 * Content URL for card thumbnails. Supplied by the injected services so
		 * previews resolve against the same host the app reads content from.
		 */
		getContentUrl?(outpoint: string): string
	}
	opns?: {
		getOrigin?(name: string): Promise<{ name: string; outpoint: string } | null>
	}
	bsv21?: {
		getTokenDetails?(tokenId: string): Promise<{
			token?: { sym?: string; dec?: string | number }
			status?: { is_active?: boolean }
		} | null>
	}
}

/** Args accepted by `createOneSatPermissionModule`. */
export interface CreateOneSatPermissionModuleArgs {
	/**
	 * The underlying wallet (NOT the WalletPermissionsManager wrapper).
	 * The module uses this for any internal derivations that should bypass
	 * the permission flow.
	 */
	wallet: WalletInterface
	/** UI callback for prompting the user. */
	promptHandler: PromptHandler
	/**
	 * Optional persistent grant store consulted before prompting for
	 * basket-access on P-baskets. Same `IPermissionStore` instance the
	 * host's `LocalWalletPermissionsManager` writes to — grants persist
	 * across protocol/basket/certificate prompts and manifest-declared
	 * grouped grants are picked up here too. When omitted, the module
	 * prompts on every basket-touching call.
	 */
	permissionStore?: IPermissionStore
	/**
	 * Optional 1Sat services used to verify card facts against ORDFS and the
	 * overlays. Omit and every card renders exactly as it would otherwise,
	 * with trust left `unverified` — no verification path may block or break
	 * a prompt.
	 *
	 * Same `OneSatServices` handle the actions context takes.
	 */
	services?: VerificationServices
	/** Optional override for commitment cache TTL (seconds). */
	commitmentTtlSeconds?: number
	/**
	 * Originator string treated as the wallet itself. Calls from this
	 * originator auto-grant. Defaults to the WalletPermissionsManager
	 * `adminOriginator` value if your wallet wires it through.
	 */
	adminOriginator?: string
}
