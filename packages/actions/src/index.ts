/**
 * 1Sat Actions
 *
 * This module provides actions (self-describing operations) for interacting with the 1Sat ecosystem.
 * All actions work with any BRC-100 compatible wallet interface via OneSatContext.
 */

// Export action registry
export { ActionRegistry, actionRegistry, type McpTool } from './action-registry'
// Export module actions and types
export * from './addresses'
// P1Sat apply (base-wallet seal / validate; module re-exports dispatch)
export {
	type ApplyFn,
	applyInscribeSigma,
	applyOpnsRegister,
	applyP1SatIntent,
	applyValidateOnly,
	P1SAT_APPLY_REGISTRY,
	prepareP1SatArgs,
	sigmaAnchorKeyId,
	stampScriptDerivedTags,
} from './apply'
export * from './collections'
// Export constants
export * from './constants'
// Export cosign module (cosigner-validated BSV21 transfer actions)
export * from './cosign'
// Export funding provider types
export type {
	FundingProvider,
	FundingResult,
} from './funding'
export * from './identity'
export * from './inscriptions'
export * from './locks'
export * from './mnee'
export * from './opns'
export * from './ordinals'
export * from './payments'
// Export registry module (on-chain package builder)
export * from './registry'
export * from './signing'
export * from './social'
// Export sweep module (uses external signing, not action-based)
export * from './sweep'
// Export sync module
export * from './sync'
export * from './tokens'
// Export action types and helpers
export {
	type Action,
	type ActionCategory,
	type ActionLogEntry,
	type ActionMetadata,
	type ActionOptions,
	createContext,
	type JsonSchemaProperty,
	type OneSatContext,
} from './types'
export {
	type CompleteSignedActionResult,
	completeSignedAction,
	type SigningCallback,
} from './utils/completeSignedAction'
export {
	createTrackedAction,
	executeTrackedAction,
	randomActionId,
} from './utils/createTrackedAction'
export { getDisplayValue } from './utils/displayValue'
export {
	type InternalizeBeefOptions,
	type InternalizeBeefResult,
	internalizeBeef,
	type OutputDerivation,
} from './utils/internalizeBeef'
export {
	type LoadBasketOutputResult,
	loadBasketOutput,
	loadBasketOutputBeef,
	toIdTag,
} from './utils/loadBasketOutput'
export { ordinalSeedTags } from './utils/ordinalSeedTags'
// Export shared utilities
export { signP2PKHInput } from './utils/signP2PKH'

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
