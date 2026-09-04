import type { CreateActionArgs } from '@bsv/sdk'
import type { OneSatContext } from '../types.js'

export interface PrepareP1SatOptions {
	/** @deprecated Dispatch lives on executeTrackedAction. Ignored. */
	usePermissionModule?: boolean
	/** @deprecated use usePermissionModule */
	useOneSatModule?: boolean
	/** @deprecated use usePermissionModule */
	useModule?: boolean
	/** @deprecated Ignored. */
	permissionScheme?: string
}

/**
 * @deprecated No-op. Ids/seals run in apply; module labels on executeTrackedAction.
 */
export async function prepareP1SatArgs(
	ctx: OneSatContext,
	args: CreateActionArgs,
	_opts: PrepareP1SatOptions = {},
): Promise<CreateActionArgs> {
	void ctx
	return args
}
