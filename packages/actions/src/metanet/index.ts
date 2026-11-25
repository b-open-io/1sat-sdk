/**
 * BRC-169 envelope plumbing shared by the handle-addressed actions (1Color
 * sends, `sendBsv` to a handle), the BRC-232 delivery codec, and the
 * `transaction-delivery` box sync.
 */

import { syncTransactionInbox } from './receive.js'

export * from './delivery.js'
export * from './envelope.js'
export * from './receive.js'

export const metanetActions = [syncTransactionInbox]
