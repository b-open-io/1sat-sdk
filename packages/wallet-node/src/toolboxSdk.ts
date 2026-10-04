import { createRequire } from 'node:module'

// @bsv/wallet-toolbox is a CommonJS package. Load the matching @bsv/sdk
// condition so the SDK objects handed to the toolbox share one runtime module
// and one nominal type identity with it; the SDK's ESM condition would create
// a dual-package hazard (the toolbox rejects a MerklePath or Beef from the ESM
// build, and private-field classes such as PrivateKey and BigNumber diverge).
export const toolboxSdk: typeof import('@bsv/sdk') = createRequire(
	import.meta.url,
)('@bsv/sdk')
