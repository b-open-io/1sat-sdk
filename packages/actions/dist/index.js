/**
 * 1Sat Actions
 *
 * This module provides actions (self-describing operations) for interacting with the 1Sat ecosystem.
 * All actions work with any BRC-100 compatible wallet interface via OneSatContext.
 */
// Export action types and helpers
export { createContext, } from './types';
// Export action registry
export { ActionRegistry, actionRegistry } from './registry';
// Export constants
export * from './constants';
// Export shared utilities
export { signP2PKHInput } from './utils/signP2PKH';
export { completeSignedAction } from './utils/completeSignedAction';
export { createTrackedAction, randomActionId } from './utils/createTrackedAction';
export { resolveBeef, extractIdTag } from './utils/resolveBeef';
// Export module actions and types
export * from './addresses';
export * from './payments';
export * from './ordinals';
export * from './tokens';
export * from './inscriptions';
export * from './locks';
export * from './signing';
export * from './opns';
// Export sweep module (uses external signing, not action-based)
export * from './sweep';
// Export sync module
export * from './sync';
import { addressesActions } from './addresses';
import { inscriptionsActions } from './inscriptions';
import { locksActions } from './locks';
import { opnsActions } from './opns';
import { ordinalsActions } from './ordinals';
import { paymentsActions } from './payments';
import { actionRegistry } from './registry';
import { signingActions } from './signing';
import { sweepActions } from './sweep';
import { syncActions } from './sync';
import { tokensActions } from './tokens';
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
]);
//# sourceMappingURL=index.js.map