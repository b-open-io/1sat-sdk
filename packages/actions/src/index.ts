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
} from './types.js'

// Export action registry
export {
	ActionRegistry,
	actionRegistry,
	type McpTool,
} from './action-registry.js'

// Export constants
export * from './constants.js'

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
} from './apply/index.js'

// Export shared utilities
export { signP2PKHInput } from './utils/signP2PKH.js'
export {
	completeSignedAction,
	type CompleteSignedActionResult,
	type SigningCallback,
} from './utils/completeSignedAction.js'
export {
	createTrackedAction,
	executeTrackedAction,
	randomActionId,
	stampManagedOutputIds,
	ensureP1SatDispatchLabel,
	ensureActionId,
	type TrackedActionOptions,
} from './utils/createTrackedAction.js'
export { hasOneSatModule } from './utils/hasOneSatModule.js'
export type { PrepareP1SatOptions } from './apply/prepare.js'
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
} from './pipeline/index.js'

// Export funding provider types
export type {
	FundingProvider,
	FundingResult,
} from './funding/index.js'
export { getDisplayValue } from './utils/displayValue.js'
export { ordinalSeedTags } from './utils/ordinalSeedTags.js'
export {
	loadBasketOutput,
	loadBasketOutputBeef,
	toIdTag,
	type LoadBasketOutputResult,
} from './utils/loadBasketOutput.js'
export {
	bsv21FieldsFromOutput,
	bsv21FilterTags,
	buildBsv21CustomInstructions,
	parseBsv21CustomInstructions,
	overwriteBsv21CiFields,
	type Bsv21RemittanceFields,
} from './utils/bsv21Remittance.js'
export { stampBsv21OutputCustomInstructions } from './utils/stampBsv21OutputCi.js'
export { stampOrdinalOutputCustomInstructions } from './utils/stampOrdinalOutputCi.js'
export {
	overwriteOrdinalCiFields,
	remittanceFromOrdinalTags,
	buildOrdinalCustomInstructions,
	type OrdinalRemittanceFields,
} from './utils/ordinalRemittance.js'
export {
	ensurePlaintextCi,
	encryptWalletMetadataCi,
	looksLikeJson,
	METADATA_ENCRYPTION_PROTOCOL,
} from './utils/walletMetadataCi.js'
export {
	internalizeBeef,
	type InternalizeBeefOptions,
	type InternalizeBeefResult,
	type OutputDerivation,
} from './utils/internalizeBeef.js'
export {
	parseOutpointBeef,
	OUTPOINT_BEEF_PREFIX,
	type ParsedOutpointBeef,
} from './utils/outpointBeef.js'
export {
	internalizeOutpointBeef,
	type TipDerivation,
	type InternalizeOutpointBeefResult,
} from './utils/internalizeOutpointBeef.js'
export {
	moveBasketOutputs,
	migrateLegacyP1SatBaskets,
	type MoveBasketOptions,
	type MoveBasketResult,
	type MigrateLegacyBasketsResult,
} from './utils/moveBasket.js'

// Export module actions and types
export * from './addresses/index.js'
export * from './collections/index.js'
export * from './payments/index.js'
export * from './ordinals/index.js'
export * from './tokens/index.js'
export * from './inscriptions/index.js'
export * from './locks/index.js'
export * from './signing/index.js'
export * from './social/index.js'
export * from './identity/index.js'
export * from './opns/index.js'
export * from './mnee/index.js'

// Export cosign module (cosigner-validated BSV21 transfer actions)
export * from './cosign/index.js'

// Export atomic two-party ordinal + BSV21 settlement primitives.
export * from './settlement/index.js'

// Export sweep module (uses external signing, not action-based)
export * from './sweep/index.js'

// Export sync module
export * from './sync/index.js'

// Export registry module (on-chain package builder)
export * from './registry/index.js'

// Export ordfs module (ord-fs/json directory writing)
export * from './ordfs/index.js'

import { actionRegistry } from './action-registry.js'
import { addressesActions } from './addresses/index.js'
import { collectionsActions } from './collections/index.js'
import { identityActions } from './identity/index.js'
import { inscriptionsActions } from './inscriptions/index.js'
import { locksActions } from './locks/index.js'
import { mneeActions } from './mnee/index.js'
import { opnsActions } from './opns/index.js'
import { ordfsActions } from './ordfs/index.js'
import { ordinalsActions } from './ordinals/index.js'
import { paymentsActions } from './payments/index.js'
import { signingActions } from './signing/index.js'
import { socialActions } from './social/index.js'
import { sweepActions } from './sweep/index.js'
import { syncActions } from './sync/index.js'
import { tokensActions } from './tokens/index.js'

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
