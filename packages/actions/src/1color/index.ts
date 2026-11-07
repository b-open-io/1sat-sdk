/**
 * 1Color (BRC-162) token actions over the wallet's BRC-207 `color` module:
 * deploy, mint, burn, the minting authority (read it, move it, end it), and
 * send to a BRC-169 handle (delivered per BRC-232). Receipt is
 * `syncTransactionInbox`.
 *
 * Everything a token's life needs after its deploy is here, because the
 * alternative is every front end building its own `p color plan` labels: the
 * module enforces the operations BRC-207 derives from a transaction, but it
 * does not build the transaction.
 */

import { authorities1Color } from './authorities.js'
import { endAuthority1Color, transferAuthority1Color } from './authority.js'
import { burn1Color } from './burn.js'
import { deploy1Color } from './deploy.js'
import { mint1Color } from './mint.js'
import { send1Color } from './send.js'

export * from './authorities.js'
export * from './authority.js'
export * from './burn.js'
export * from './custody.js'
export * from './deploy.js'
export * from './delivery.js'
export * from './mint.js'
export * from './plan.js'
export * from './receipt.js'
export * from './send.js'

export const oneColorActions = [
	deploy1Color,
	send1Color,
	mint1Color,
	burn1Color,
	endAuthority1Color,
	transferAuthority1Color,
	authorities1Color,
]
