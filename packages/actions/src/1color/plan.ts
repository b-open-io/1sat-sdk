/**
 * The `p color plan` labels every 1Color action carries: one asset, the
 * operations BRC-207 derives from the transaction, and the outputs this wallet
 * keeps. The module refuses an action whose plan does not declare *exactly*
 * the operations the funded transaction turns out to need, so each builder
 * here states what it is about to build, and the module checks it against what
 * the wallet actually has:
 *
 * | action                    | operations declared                        |
 * | ------------------------- | ------------------------------------------ |
 * | `mint1Color`              | `mint`, `authority-transfer`                |
 * | `burn1Color`              | `burn` (plus `transfer` with a remainder)   |
 * | `endAuthority1Color`      | `authority-end`                             |
 * | `transferAuthority1Color` | `authority-transfer`                        |
 * | `send1Color`              | `transfer`                                  |
 *
 * `inputPositions` and `changePositions` stay empty: these builders either let
 * the module select and position its inputs (`mint`, `authority-transfer`), or
 * name explicit inputs without pinning their index (`burn`, `authority-end`),
 * and none of them takes token change — a burn's remainder and a mint's
 * continuing authority are requested outputs the module can position.
 */

import {
	type COLOR_OPERATIONS,
	ColorPlan,
	type ColorRemittance,
	assetBasket,
} from '@bsv/color-permission-module'

/** The message every 1Color action returns for an asset id it cannot parse. */
export const INVALID_ASSET_ID = 'invalid-asset-id: expected <txid>_<vout>'

/** The message an authority action returns when the wallet holds nothing to spend. */
export const noAuthority = (assetId: string): string =>
	`no-authority-for-asset: this wallet holds no spendable authority for ${assetId}`

/** Whether `assetId` is a canonical `<txid>_<vout>` asset id (so, not `ISSUE`). */
export function isColorAssetId(assetId: string): boolean {
	try {
		assetBasket(assetId, 'value')
		return true
	} catch {
		return false
	}
}

/**
 * A plan operation for an asset that already exists: the deploy operations
 * (`deploy-fixed`, `deploy-authority`) belong to a deploy's `ISSUE` asset and
 * so to `deploy1Color`, not to these labels.
 */
export type ColorActionOperation = Exclude<
	(typeof COLOR_OPERATIONS)[number],
	'deploy-fixed' | 'deploy-authority'
>

/** The plan labels of a one-asset 1Color action. */
export function colorPlanLabels(params: {
	assetId: string
	operations: ColorActionOperation[]
	ownedOutputs: ColorRemittance[]
}): string[] {
	const { assetId, operations, ownedOutputs } = params
	return ColorPlan.toLabels({
		version: 1,
		assets: [assetId],
		ownedOutputs,
		operations: operations.map((operation) => ({ assetId, operation })),
		inputPositions: [],
		changePositions: [],
		sighashTypes: [],
	})
}
