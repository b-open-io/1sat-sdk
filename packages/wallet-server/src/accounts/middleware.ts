/**
 * Accounts integration with @bsv/payment-express-middleware.
 *
 * - `accountsPriceCalculator` — `calculateRequestPrice` callback for the
 *   payment middleware. Returns 0 for unmetered requests (non-billable
 *   methods, free identities, accounts disabled). Otherwise returns the
 *   sats owed under our refund-credit pricing model.
 *
 * - `accountsPaymentRecorder` — post-payment Express middleware that runs
 *   AFTER the payment middleware has accepted a payment. It writes a row
 *   into the `payments` table so future quotes see the new paid capacity.
 */

import { Transaction, Utils, type WalletInterface } from '@bsv/sdk'
import type { NextFunction, Request, Response } from 'express'
import { isBillableMethod } from '../dispatch'
import type { WalletStorageProvider } from '../types'
import { type RefundedQuote, quoteRefundedCharge } from './pricing'
import type { AccountsRepo } from './repo'
import type { AccountsConfig, IdentityKey } from './types'

export interface AccountsMiddlewareDeps {
	config: AccountsConfig
	walletStorage: WalletStorageProvider
	repo: AccountsRepo
	wallet: WalletInterface
	serverIdentityKey: IdentityKey
	/** Returns the current chain tip block height. */
	currentBlock: () => Promise<number>
}

/** Extra fields the accounts layer stashes on the request for the post-payment recorder. */
interface AccountsRequestState {
	quote?: RefundedQuote
	identityKey?: IdentityKey
}

type AccountsRequest = Request & {
	_accounts?: AccountsRequestState
	auth?: { identityKey?: string }
	payment?: { tx?: string; satoshisPaid?: number }
}

/**
 * Returns a `calculateRequestPrice` function wired to our refund-credit
 * pricing. Used as the middleware option of `createPaymentMiddleware`.
 */
export function accountsPriceCalculator(
	deps: AccountsMiddlewareDeps,
): (req: Request) => Promise<number> {
	const freeKeys = new Set<IdentityKey>([
		deps.serverIdentityKey,
		...(deps.config.freeIdentityKeys ?? []),
	])

	return async (req: Request) => {
		if (!deps.config.enabled) return 0

		const reqx = req as AccountsRequest
		const method = extractJsonRpcMethod(reqx)
		if (method == null || !isBillableMethod(method)) return 0

		// Break the 402-building-402 loop: a createAction whose outputs pay
		// this server's identity is either AuthFetch building a BRC-0121
		// payment to us, or some equivalent self-directed flow. Billing it
		// would cause infinite recursion, so we let it through free. The
		// resulting payment tx still lands in the user's storage and counts
		// toward their usage like any other tx.
		if (method === 'createAction' && isSelfPaymentBuild(reqx, deps.serverIdentityKey)) {
			return 0
		}

		const identityKey = reqx.auth?.identityKey
		if (!identityKey) return 0
		if (freeKeys.has(identityKey)) return 0

		const userId = await resolveUserId(deps.walletStorage, identityKey)
		if (userId == null) return 0 // first billable call; metering starts next

		const currentBlock = await deps.currentBlock()
		const [usedBytes, currentPayment] = await Promise.all([
			deps.repo.measureUsedBytes(userId),
			deps.repo.getCurrentPayment(identityKey, currentBlock),
		])
		const quote = quoteRefundedCharge({
			usedBytes,
			currentPayment,
			currentBlock,
			config: deps.config,
		})
		if (!quote) return 0

		reqx._accounts = {
			quote,
			identityKey,
		}
		return quote.chargeSats
	}
}

/**
 * Post-payment middleware. Reads the payment-middleware's `req.payment`
 * (set after `wallet.internalizeAction` succeeded) and records the new
 * payment row so future calls see the expanded capacity.
 */
export function accountsPaymentRecorder(deps: AccountsMiddlewareDeps) {
	return async (
		req: AccountsRequest,
		_res: Response,
		next: NextFunction,
	): Promise<void> => {
		const payment = req.payment
		const state = req._accounts
		if (!payment?.tx || !state?.quote || !state.identityKey) return next()

		try {
			const beef = Utils.toArray(payment.tx, 'base64')
			const tx = Transaction.fromAtomicBEEF(beef)
			const txid = tx.id('hex') as string
			if (!(await deps.repo.paymentExists(txid))) {
				await deps.repo.upsertAccount(state.identityKey)
				await deps.repo.recordPayment({
					identityKey: state.identityKey,
					txid,
					bytesCovered: state.quote.bytesCovered,
					satsPaid: state.quote.chargeSats,
					paidThroughBlock: state.quote.paidThroughBlock,
				})
			}
		} catch (err) {
			console.error('[accounts] failed to record payment:', err)
		}
		next()
	}
}

async function resolveUserId(
	storage: WalletStorageProvider,
	identityKey: IdentityKey,
): Promise<number | undefined> {
	const result = await storage.findOrInsertUser(identityKey)
	return result?.user?.userId
}

function extractJsonRpcMethod(req: Request): string | undefined {
	const body = req.body
	if (typeof body !== 'object' || body === null) return undefined
	const method = (body as { method?: unknown }).method
	return typeof method === 'string' ? method : undefined
}

/**
 * Returns true when the JSON-RPC body is a createAction whose outputs
 * include at least one entry earmarked as a payment to this server (via
 * `customInstructions = { payee: serverIdentityKey, ... }`).
 */
function isSelfPaymentBuild(
	req: Request,
	serverIdentityKey: IdentityKey,
): boolean {
	// wallet-toolbox RPCs are shaped `method(auth, args)`. args (with outputs)
	// lives at params[1]; params[0] carries identity/auth fields.
	const body = req.body as { params?: unknown }
	const params = Array.isArray(body?.params) ? body.params : []
	const args = params[1] as { outputs?: unknown } | undefined
	const outputs = Array.isArray(args?.outputs) ? args.outputs : []
	for (const out of outputs) {
		if (typeof out !== 'object' || out === null) continue
		const ci = (out as { customInstructions?: unknown }).customInstructions
		if (typeof ci !== 'string') continue
		try {
			const parsed = JSON.parse(ci) as { payee?: unknown }
			if (parsed?.payee === serverIdentityKey) return true
		} catch {}
	}
	return false
}
