import type {
	CreateActionArgs,
	CreateActionResult,
	CreateSignatureArgs,
	GetPublicKeyArgs,
} from '@bsv/sdk'
import { CommitmentCache } from './commitmentCache'
import {
	handleCreateActionRequest,
	handleCreateActionResponse,
	handleCreateSignatureRequest,
	handleGetPublicKeyRequest,
} from './handlers'
import {
	type CreateOneSatPermissionModuleArgs,
	DEFAULT_COMMITMENT_TTL_SECONDS,
} from './types'

/**
 * Mirror of the `PermissionsModule` interface from `@bsv/wallet-toolbox`.
 * Duplicated here to keep this package free of a hard dependency on the
 * toolbox at type-level — consumers register the returned object under
 * `permissionModules['1sat']` in their `WalletPermissionsManager` config.
 */
export interface PermissionsModule {
	onRequest(req: {
		method: string
		args: object
		originator: string
	}): Promise<{ args: object }>
	onResponse(
		res: unknown,
		context: { method: string; originator: string },
	): Promise<unknown>
}

/** Returned by the factory; lets callers stop the cache eviction timer. */
export interface OneSatPermissionModule extends PermissionsModule {
	/** Stop the periodic cache eviction. */
	dispose(): void
}

/**
 * Build a permission module that gates 1Sat-asset signing via hashOutputs
 * commitments captured at createAction time.
 *
 * Register the returned object in `WalletPermissionsManager` config:
 *
 *   const oneSat = createOneSatPermissionModule({ wallet, promptHandler });
 *   new WalletPermissionsManager(wallet, adminOriginator, {
 *     permissionModules: { '1sat': oneSat },
 *   });
 */
export function createOneSatPermissionModule(
	args: CreateOneSatPermissionModuleArgs,
): OneSatPermissionModule {
	const cache = new CommitmentCache(
		args.commitmentTtlSeconds ?? DEFAULT_COMMITMENT_TTL_SECONDS,
	)
	cache.start()

	const deps = {
		wallet: args.wallet,
		promptHandler: args.promptHandler,
		cache,
		adminOriginator: args.adminOriginator,
	}

	return {
		async onRequest(req) {
			switch (req.method) {
				case 'createAction': {
					const next = await handleCreateActionRequest(
						deps,
						req.args as CreateActionArgs,
						req.originator,
					)
					return { args: next }
				}
				case 'createSignature': {
					const next = await handleCreateSignatureRequest(
						deps,
						req.args as CreateSignatureArgs,
						req.originator,
					)
					return { args: next }
				}
				case 'getPublicKey': {
					const next = await handleGetPublicKeyRequest(
						deps,
						req.args as GetPublicKeyArgs,
						req.originator,
					)
					return { args: next }
				}
				default:
					return { args: req.args }
			}
		},

		async onResponse(res, context) {
			if (context.method === 'createAction') {
				return handleCreateActionResponse(
					deps,
					res as CreateActionResult,
					context.originator,
				)
			}
			return res
		},

		dispose() {
			cache.stop()
		},
	}
}
