/**
 * Mandala (BRC-162) token actions: deploy, send to a BRC-169 handle
 * (delivered per BRC-232), and receive from `mandala_inbox`.
 */

import { deployMandala, fileMandalaDeploy } from './deploy.js'
import { syncMandalaInbox } from './receive.js'
import { sendMandala } from './send.js'

export * from './deploy.js'
export * from './send.js'
export * from './receive.js'

export const mandalaActions = [
	deployMandala,
	fileMandalaDeploy,
	sendMandala,
	syncMandalaInbox,
]
