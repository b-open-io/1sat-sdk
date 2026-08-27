import {
	type PermissionSchemeId,
	PERMISSION_SCHEME_IDS,
	PERMISSION_SCHEMES,
	basketForScheme,
} from '@1sat/types'
import type {
	CreateActionArgs,
	CreateActionResult,
	CreateSignatureArgs,
	GetPublicKeyArgs,
	InternalizeActionArgs,
	ListOutputsArgs,
} from '@bsv/sdk'
import { CommitmentCache } from './commitmentCache'
import {
	handleCreateActionRequest,
	handleCreateActionResponse,
	handleCreateSignatureRequest,
	handleGetPublicKeyRequest,
	handleInternalizeActionRequest,
	handleListOutputsRequest,
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
 * Build a permission module for one BRC-99 scheme id.
 *
 * Register under that scheme in `WalletPermissionsManager`:
 *
 *   const modules = createAssetPermissionModules({ wallet, promptHandler });
 *   new WalletPermissionsManager(wallet, adminOriginator, {
 *     permissionModules: modules,
 *   });
 */
export function createOneSatPermissionModule(
	args: CreateOneSatPermissionModuleArgs,
): OneSatPermissionModule {
	const schemeId: PermissionSchemeId =
		args.schemeId ?? PERMISSION_SCHEMES.ONESAT
	const ownedBaskets = new Set(
		(args.baskets ?? [basketForScheme(schemeId)]).map((b) =>
			b.trim().toLowerCase(),
		),
	)

	const cache = new CommitmentCache(
		args.commitmentTtlSeconds ?? DEFAULT_COMMITMENT_TTL_SECONDS,
	)
	cache.start()

	const deps = {
		wallet: args.wallet,
		promptHandler: args.promptHandler,
		cache,
		schemeId,
		ownedBaskets,
		adminOriginator: args.adminOriginator,
		permissionStore: args.permissionStore,
		services: args.services,
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
				case 'listOutputs': {
					const next = await handleListOutputsRequest(
						{
							schemeId: deps.schemeId,
							ownedBaskets: deps.ownedBaskets,
							promptHandler: deps.promptHandler,
							adminOriginator: deps.adminOriginator,
							permissionStore: deps.permissionStore,
							services: deps.services,
						},
						req.args as ListOutputsArgs,
						req.originator,
					)
					return { args: next }
				}
				case 'internalizeAction': {
					const next = await handleInternalizeActionRequest(
						deps,
						req.args as InternalizeActionArgs,
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

/**
 * Build one module instance per known asset scheme (`1sat`, `opns`, `bsv21`, `lock`).
 * Hosts spread the result into `permissionModules`.
 */
export function createAssetPermissionModules(
	args: Omit<CreateOneSatPermissionModuleArgs, 'schemeId' | 'baskets'>,
): Record<PermissionSchemeId, OneSatPermissionModule> {
	const out = {} as Record<PermissionSchemeId, OneSatPermissionModule>
	for (const schemeId of PERMISSION_SCHEME_IDS) {
		out[schemeId] = createOneSatPermissionModule({ ...args, schemeId })
	}
	return out
}
