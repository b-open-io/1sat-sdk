/**
 * Compile-time export checks for key subpath APIs.
 */

import type { Action } from '@1sat/actions'
import type { OneSatServices } from '@1sat/client'
import type {
	AddressSyncManager,
	OneSatWallet,
	OneSatWalletEvents,
} from '@1sat/wallet'
import type { OneSatWallet as OneSatWalletBrowser } from '@1sat/wallet/browser'
import type { OneSatWallet as OneSatWalletNode } from '@1sat/wallet/node'

type ExportCheck =
	| OneSatServices
	| Action
	| OneSatWallet
	| OneSatWalletEvents
	| AddressSyncManager
	| OneSatWalletBrowser
	| OneSatWalletNode

export type { ExportCheck }
