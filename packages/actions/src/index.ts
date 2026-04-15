/**
 * 1Sat Actions
 *
 * This module provides actions (self-describing operations) for interacting with the 1Sat ecosystem.
 * All actions work with any BRC-100 compatible wallet interface via OneSatContext.
 */

// Export action types and helpers
export {
	type Action,
	type ActionCategory,
	type ActionLogEntry,
	type ActionMetadata,
	type ActionOptions,
	type JsonSchemaProperty,
	type OneSatContext,
	createContext,
} from './types'

// Export action registry
export { ActionRegistry, actionRegistry, type McpTool } from './action-registry'

// Export constants
export * from './constants'

// Export shared utilities
export { signP2PKHInput } from './utils/signP2PKH'
export {
	completeSignedAction,
	type CompleteSignedActionResult,
	type SigningCallback,
} from './utils/completeSignedAction'
export {
	createTrackedAction,
	executeTrackedAction,
	randomActionId,
} from './utils/createTrackedAction'

// Export funding provider types
export type {
	FundingProvider,
	FundingResult,
} from './funding'
export { resolveBeef, extractIdTag } from './utils/resolveBeef'
export { getDisplayValue } from './utils/displayValue'
export {
	internalizeBeef,
	type InternalizeBeefOptions,
	type InternalizeBeefResult,
	type OutputDerivation,
} from './utils/internalizeBeef'

// Export module actions and types
export * from './addresses'
export * from './collections'
export * from './payments'
export * from './ordinals'
export * from './tokens'
export * from './inscriptions'
export * from './locks'
export * from './signing'
export * from './social'
export * from './identity'
export * from './opns'
export * from './mnee'

// Export sweep module (uses external signing, not action-based)
export * from './sweep'

// Export sync module
export * from './sync'

// Export registry module (on-chain package builder)
export * from './registry'

import { actionRegistry } from './action-registry'
import { addressesActions } from './addresses'
import { collectionsActions } from './collections'
import { identityActions } from './identity'
import { inscriptionsActions } from './inscriptions'
import { locksActions } from './locks'
import { mneeActions } from './mnee'
import { opnsActions } from './opns'
import { ordinalsActions } from './ordinals'
import { paymentsActions } from './payments'
import { signingActions } from './signing'
import { socialActions } from './social'
import { sweepActions } from './sweep'
import { syncActions } from './sync'
import { tokensActions } from './tokens'

actionRegistry.registerAll([
	...addressesActions,
	...collectionsActions,
	...identityActions,
	...paymentsActions,
	...ordinalsActions,
	...tokensActions,
	...inscriptionsActions,
	...locksActions,
	...signingActions,
	...socialActions,
	...sweepActions,
	...opnsActions,
	...syncActions,
	...mneeActions,
])

// Re-export SDK types that consumers commonly need
export type {
	CreateActionArgs,
	CreateActionInput,
	CreateActionOutput,
	CreateActionResult,
	ListOutputsArgs,
	ListOutputsResult,
	WalletInterface,
	WalletOutput,
} from '@bsv/sdk'
