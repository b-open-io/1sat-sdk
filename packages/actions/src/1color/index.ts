/**
 * 1Color (BRC-162) token actions over the wallet's BRC-207 `color` module:
 * deploy, and send to a BRC-169 handle (delivered per BRC-232). Receipt is
 * `syncTransactionInbox`.
 */

import { deploy1Color } from './deploy.js'
import { send1Color } from './send.js'

export * from './deploy.js'
export * from './send.js'
export * from './receipt.js'

export const oneColorActions = [deploy1Color, send1Color]
