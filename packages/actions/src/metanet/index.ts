/**
 * BRC-169 envelope plumbing shared by the handle-addressed actions (Mandala
 * sends, `sendBsv` to a handle) and the `metanet_inbox` sync.
 */

import { syncMetanetInbox } from './receive.js'

export * from './envelope.js'
export * from './receive.js'

export const metanetActions = [syncMetanetInbox]
