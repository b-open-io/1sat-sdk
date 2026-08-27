import type { PermissionSchemeId } from '@1sat/types'
import { PERMISSION_SCHEMES } from '@1sat/types'
import type { CreateActionArgs } from '@bsv/sdk'
import type { OneSatContext } from '../types'
import {
	ensureSchemeDispatchLabel,
	stampManagedOutputIds,
} from '../utils/createTrackedAction'

export interface PrepareP1SatOptions {
	/**
	 * Opt-in permission module. Default **false**.
	 * When true: dispatch labels only (pipeline runs inside module after approve).
	 * @deprecated Prefer usePermissionModule on executeTrackedAction.
	 */
	usePermissionModule?: boolean
	/** @deprecated use usePermissionModule */
	useOneSatModule?: boolean
	/** @deprecated use usePermissionModule */
	useModule?: boolean
	/** Scheme for dispatch label when module opt-in is set. Default `1sat`. */
	permissionScheme?: PermissionSchemeId
}

/**
 * Lightweight prepare: stamp ids; optionally add module dispatch labels.
 * Seals/completion live in the shared pipeline.
 */
export async function prepareP1SatArgs(
	ctx: OneSatContext,
	args: CreateActionArgs,
	opts: PrepareP1SatOptions = {},
): Promise<CreateActionArgs> {
	void ctx
	const useModule =
		opts.usePermissionModule ?? opts.useOneSatModule ?? opts.useModule ?? false
	stampManagedOutputIds(args)
	if (useModule) {
		ensureSchemeDispatchLabel(
			args,
			opts.permissionScheme ?? PERMISSION_SCHEMES.ONESAT,
		)
	}
	return args
}
