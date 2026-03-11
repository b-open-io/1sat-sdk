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
	type JsonSchemaProperty,
	type OneSatContext,
	createContext,
} from './types'

// Export action registry
export { ActionRegistry, actionRegistry, type McpTool } from './registry'

// Export constants
export * from './constants'

// Export shared utilities
export { signP2PKHInput } from './utils/signP2PKH'
export { completeSignedAction, type CompleteSignedActionResult, type SigningCallback } from './utils/completeSignedAction'

// Export module actions and types
export * from './addresses'
export * from './payments'
export * from './ordinals'
export * from './tokens'
export * from './inscriptions'
export * from './locks'
export * from './signing'
export * from './opns'

// Export sweep module (uses external signing, not action-based)
export * from './sweep'

// Export sync module
export * from './sync'

import { addressesActions } from './addresses'
import { inscriptionsActions } from './inscriptions'
import { locksActions } from './locks'
import { opnsActions } from './opns'
import { ordinalsActions } from './ordinals'
import { paymentsActions } from './payments'
import { actionRegistry } from './registry'
import { signingActions } from './signing'
import { sweepActions } from './sweep'
import { syncActions } from './sync'
import { tokensActions } from './tokens'

actionRegistry.registerAll([
	...addressesActions,
	...paymentsActions,
	...ordinalsActions,
	...tokensActions,
	...inscriptionsActions,
	...locksActions,
	...signingActions,
	...sweepActions,
	...opnsActions,
	...syncActions,
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
