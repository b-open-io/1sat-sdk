/**
 * Express middleware + route handlers for the accounts layer.
 *
 * - `accountsCapacityGate(deps)` — runs between auth and dispatch. On a
 *   billable method whose caller is over capacity, returns `507 Insufficient
 *   Storage` with a JSON body describing the deficit + pricing. We don't use
 *   HTTP 402 here: that would trigger AuthFetch's auto-pay retry, and the
 *   retry's `wallet.createAction` deadlocks against the manager's lock when
 *   the caller's active storage is the same server we're billing them for.
 *
 * - `accountsPaymentHandler(deps)` — handler for `POST /account/payment`.
 *   Accepts a BRC-29 payment body, calls `wallet.internalizeAction` to
 *   validate + record the incoming tx, writes a row into the accounts
 *   ledger so subsequent billable requests see the new paid capacity.
 */

import { type WalletInterface, Transaction, Utils } from '@bsv/sdk'
import type { NextFunction, Request, Response } from 'express'
import { isBillableMethod } from '../dispatch'
import type { WalletStorageProvider } from '../types'
import { quoteRefundedCharge } from './pricing'
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

type AuthedRequest = Request & { auth?: { identityKey?: string } }

/** JSON-RPC error code for "insufficient storage capacity". */
export const ERR_INSUFFICIENT_CAPACITY = -32005

/**
 * Express middleware. Runs between auth and dispatch. For billable methods
 * when the caller is over capacity, short-circuits with 507 + quota info.
 * Otherwise calls next() and dispatch runs normally.
 */
export function accountsCapacityGate(deps: AccountsMiddlewareDeps) {
	const freeKeys = new Set<IdentityKey>([
		deps.serverIdentityKey,
		...(deps.config.freeIdentityKeys ?? []),
	])

	return async (req: Request, res: Response, next: NextFunction) => {
		try {
			if (!deps.config.enabled) return next()

			const method = extractJsonRpcMethod(req)
			if (method == null || !isBillableMethod(method)) return next()

			const identityKey = (req as AuthedRequest).auth?.identityKey
			if (!identityKey) return next()
			if (freeKeys.has(identityKey)) return next()

			const userId = await resolveUserId(deps.walletStorage, identityKey)
			// First billable call creates the user row — gets a free pass.
			if (userId == null) return next()

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
			if (!quote) return next()

			const id = normalizeJsonRpcId((req.body as { id?: unknown })?.id)
			return res.status(507).json({
				jsonrpc: '2.0',
				error: {
					code: ERR_INSUFFICIENT_CAPACITY,
					message: 'insufficient storage capacity',
					data: {
						usedBytes,
						baselineBytes: deps.config.baselineBytes,
						paidBytes: currentPayment?.bytesCovered ?? 0,
						capacityBytes:
							deps.config.baselineBytes + (currentPayment?.bytesCovered ?? 0),
						deficitBytes: quote.bytesCovered,
						satsRequired: quote.chargeSats,
						fullSats: quote.fullSats,
						refundSats: quote.refundSats,
						paidThroughBlock: quote.paidThroughBlock,
						currentBlock,
						pricing: {
							purchaseUnitBytes: deps.config.purchaseUnitBytes,
							satsPerUnit: deps.config.satsPerUnit,
							durationBlocks: deps.config.durationBlocks,
						},
						paymentEndpoint: '/account/payment',
						serverIdentityKey: deps.serverIdentityKey,
					},
				},
				id,
			})
		} catch (err) {
			console.error('[accounts] capacity gate error:', err)
			return next()
		}
	}
}

interface PostPaymentBody {
	transaction?: string // base64 AtomicBEEF
	derivationPrefix?: string
	derivationSuffix?: string
	outputIndex?: number
}

/**
 * Handler for `POST /account/payment`. BRC-29 payment body; the server
 * internalizes the tx against its own wallet and records the capacity
 * credit in the accounts ledger.
 */
export function accountsPaymentHandler(deps: AccountsMiddlewareDeps) {
	return async (req: Request, res: Response) => {
		const identityKey = (req as AuthedRequest).auth?.identityKey
		if (!identityKey || identityKey === 'unknown') {
			return res.status(401).json({ error: 'Unauthenticated' })
		}
		if (!deps.config.enabled) {
			return res.status(400).json({ error: 'accounts not enabled' })
		}

		const body = req.body as PostPaymentBody
		if (
			typeof body?.transaction !== 'string' ||
			typeof body?.derivationPrefix !== 'string' ||
			typeof body?.derivationSuffix !== 'string'
		) {
			return res.status(400).json({
				error:
					'missing fields — expected { transaction: base64, derivationPrefix, derivationSuffix, outputIndex? }',
			})
		}

		let beef: number[]
		let txid: string
		let satoshisAtOutput: number
		const outputIndex =
			typeof body.outputIndex === 'number' ? body.outputIndex : 0
		try {
			beef = Utils.toArray(body.transaction, 'base64')
			const tx = Transaction.fromAtomicBEEF(beef)
			txid = tx.id('hex') as string
			const out = tx.outputs[outputIndex]
			if (!out) throw new Error(`no output at index ${outputIndex}`)
			satoshisAtOutput = out.satoshis ?? 0
		} catch (err) {
			return res
				.status(400)
				.json({ error: `invalid payment tx: ${(err as Error).message}` })
		}

		if (await deps.repo.paymentExists(txid)) {
			return res.status(409).json({ error: 'payment already applied', txid })
		}

		const currentBlock = await deps.currentBlock()
		const userId = await resolveUserId(deps.walletStorage, identityKey)
		const usedBytes =
			userId == null ? 0 : await deps.repo.measureUsedBytes(userId)
		const currentPayment = await deps.repo.getCurrentPayment(
			identityKey,
			currentBlock,
		)
		const quote = quoteRefundedCharge({
			usedBytes,
			currentPayment,
			currentBlock,
			config: deps.config,
		})

		// If no quote needed (under capacity), the user is overpaying; accept
		// the payment anyway. We still internalize and record so they get
		// whatever capacity the sats cover.
		const bytesCovered =
			quote?.bytesCovered ??
			Math.max(
				deps.config.purchaseUnitBytes,
				Math.ceil(satoshisAtOutput / deps.config.satsPerUnit) *
					deps.config.purchaseUnitBytes,
			)
		const paidThroughBlock =
			quote?.paidThroughBlock ?? currentBlock + deps.config.durationBlocks

		try {
			await deps.wallet.internalizeAction({
				tx: beef,
				outputs: [
					{
						paymentRemittance: {
							derivationPrefix: body.derivationPrefix,
							derivationSuffix: body.derivationSuffix,
							senderIdentityKey: identityKey,
						},
						outputIndex,
						protocol: 'wallet payment',
					},
				],
				labels: ['wallet-server', 'account-payment'],
				description: 'wallet-server storage capacity payment',
			})
		} catch (err) {
			return res.status(400).json({
				error: `wallet.internalizeAction rejected payment: ${(err as Error).message}`,
			})
		}

		await deps.repo.upsertAccount(identityKey)
		const payment = await deps.repo.recordPayment({
			identityKey,
			txid,
			bytesCovered,
			satsPaid: satoshisAtOutput,
			paidThroughBlock,
		})

		return res.status(200).json({
			status: 'ok',
			payment: {
				txid: payment.txid,
				satsPaid: payment.satsPaid,
				bytesCovered: payment.bytesCovered,
				paidThroughBlock: payment.paidThroughBlock,
			},
		})
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

function normalizeJsonRpcId(id: unknown): string | number | null {
	if (typeof id === 'string' || typeof id === 'number') return id
	return null
}
