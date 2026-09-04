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

// P1Sat apply (base-wallet seal / validate; module re-exports dispatch)
export {
	applyP1SatCreateAction,
	applyP1SatIntent,
	applyOpnsRegister,
	applyInscribeSigma,
	applyValidateOnly,
	prepareP1SatArgs,
	sigmaAnchorKeyId,
	stampScriptDerivedTags,
	P1SAT_APPLY_REGISTRY,
	type ApplyFn,
} from './apply'

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
	stampManagedOutputIds,
	ensureP1SatDispatchLabel,
	ensureActionId,
	type TrackedActionOptions,
} from './utils/createTrackedAction'
export { hasOneSatModule } from './utils/hasOneSatModule'
export type { PrepareP1SatOptions } from './apply/prepare'
export {
	type Spend,
	type ResolvedSpend,
	type SpendTarget,
	type BasketSpendTarget,
	type OutpointSpendTarget,
	type PipelineOptions,
	spendsFromLabels,
	labelsFromSpends,
	spendToLabel,
	spendTargetsFromLabels,
	labelsFromSpendTargets,
	spendTargetToLabel,
	buildSpendsForTargets,
	buildSpendsForResolved,
	materializeSpends,
	resolveSpendTargets,
	unlockByScript,
	buildPurchaseUnlockingScript,
	runCreateActionPipeline,
	finishCreateAction,
	embellishCreateActionArgs,
} from './pipeline'

// Export funding provider types
export type {
	FundingProvider,
	FundingResult,
} from './funding'
export { getDisplayValue } from './utils/displayValue'
export { ordinalSeedTags } from './utils/ordinalSeedTags'
export {
	loadBasketOutput,
	loadBasketOutputBeef,
	toIdTag,
	type LoadBasketOutputResult,
} from './utils/loadBasketOutput'
export {
	bsv21FieldsFromOutput,
	bsv21FilterTags,
	buildBsv21CustomInstructions,
	parseBsv21CustomInstructions,
	overwriteBsv21CiFields,
	type Bsv21RemittanceFields,
} from './utils/bsv21Remittance'
export { stampBsv21OutputCustomInstructions } from './utils/stampBsv21OutputCi'
export { stampOrdinalOutputCustomInstructions } from './utils/stampOrdinalOutputCi'
export {
	overwriteOrdinalCiFields,
	remittanceFromOrdinalTags,
	buildOrdinalCustomInstructions,
	type OrdinalRemittanceFields,
} from './utils/ordinalRemittance'
export {
	ensurePlaintextCi,
	encryptWalletMetadataCi,
	looksLikeJson,
	METADATA_ENCRYPTION_PROTOCOL,
} from './utils/walletMetadataCi'
export {
	internalizeBeef,
	type InternalizeBeefOptions,
	type InternalizeBeefResult,
	type OutputDerivation,
} from './utils/internalizeBeef'
export {
	moveBasketOutputs,
	migrateLegacyP1SatBaskets,
	type MoveBasketOptions,
	type MoveBasketResult,
	type MigrateLegacyBasketsResult,
} from './utils/moveBasket'

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

// Export cosign module (cosigner-validated BSV21 transfer actions)
export * from './cosign'

// Export sweep module (uses external signing, not action-based)
export * from './sweep'

// Export sync module
export * from './sync'

// Export registry module (on-chain package builder)
export * from './registry'

// Export ordfs module (ord-fs/json directory writing)
export * from './ordfs'

import { actionRegistry } from './action-registry'
import { addressesActions } from './addresses'
import { collectionsActions } from './collections'
import { identityActions } from './identity'
import { inscriptionsActions } from './inscriptions'
import { locksActions } from './locks'
import { mneeActions } from './mnee'
import { opnsActions } from './opns'
import { ordfsActions } from './ordfs'
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
	...ordfsActions,
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
