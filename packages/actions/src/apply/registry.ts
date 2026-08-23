import type { CreateActionArgs, WalletInterface } from '@bsv/sdk'
import { applyInscribeSigma } from './inscribeSigma'
import { applyOpnsRegister } from './opnsRegister'
import { applyValidateOnly } from './validateOnly'

export type ApplyFn = (
	wallet: WalletInterface,
	args: CreateActionArgs,
) => Promise<void>

/**
 * Intent → apply. Rewrite only for trusted seals (PushDrop/sigma).
 * Everything else is validate-only (currently no-op).
 */
export const P1SAT_APPLY_REGISTRY: Record<string, ApplyFn> = {
	'opns.register': applyOpnsRegister,
	'opns.deregister': applyValidateOnly,
	'opns.list': applyValidateOnly,
	'opns.transfer': applyValidateOnly,
	'opns.cancel-listing': applyValidateOnly,
	'opns.purchase': applyValidateOnly,
	'ordinal.transfer': applyValidateOnly,
	'ordinal.list': applyValidateOnly,
	'ordinal.cancel-listing': applyValidateOnly,
	'ordinal.purchase': applyValidateOnly,
	'ordinal.burn': applyValidateOnly,
	'ordinal.inscribe': applyValidateOnly,
	'ordinal.inscribe-sigma': applyInscribeSigma,
	'ordfs.deploy': applyValidateOnly,
	'ordfs.deploy-sigma': applyInscribeSigma,
	'ordinal.mint-collection': applyValidateOnly,
	'ordinal.mint-item': applyValidateOnly,
	'lock.lock': applyValidateOnly,
	'lock.unlock': applyValidateOnly,
	'bsv21.transfer': applyValidateOnly,
	'bsv21.purchase': applyValidateOnly,
	'bsv21.mint': applyValidateOnly,
	'bsv21.deploy': applyValidateOnly,
}
