/**
 * Express middleware + route handlers for the accounts layer.
 *
 * - `accountsCapacityGate(deps)` — runs between auth and dispatch. On a
 *   billable method whose caller is over capacity, returns `507 Insufficient
 *   Storage` with a JSON body describing the deficit + pricing. Two bypass
 *   paths let an account-payment flow through even when the user is over
 *   capacity: one for `createAction` (validated against request args), one
 *   for `processAction` (validated against the stored action's outputs).
 *
 * - `accountsPaymentHandler(deps)` — handler for `POST /account/payment`.
 *   Accepts a BRC-29 payment body, calls `wallet.internalizeAction` to
 *   record the incoming tx against the server's own wallet, credits the
 *   accounts ledger, returns the updated quota.
 */

import {
	P2PKH,
	PublicKey,
	type WalletInterface,
	Transaction,
	Utils,
} from '@bsv/sdk'
import type { NextFunction, Request, Response } from 'express'
import { isBillableMethod } from '../dispatch'
import type { WalletStorageProvider } from '../types'
import { quoteRefundedCharge } from './pricing'
import type { AccountsRepo } from './repo'
import type { AccountsConfig, IdentityKey, NextPaymentDerivation } from './types'

/** BRC-29 protocol ID for wallet payments (matches @1sat/types constant). */
const BRC29_PROTOCOL_ID: [2, string] = [2, '3241645161d8']
/** Static derivation prefix for every wallet-server account payment. */
const PAYMENT_DERIVATION_PREFIX = 'wallet-storage'
/** Cap on non-change outputs allowed in a bypassed createAction, to stop
 * clients from smuggling unrelated work into the payment tx. */
const MAX_OUTPUTS_IN_BYPASSED_CREATE_ACTION = 2

/**
 * Runtime storage surface the gate uses for processAction bypass lookups.
 * `findTransactions` and `findOutputs` are exposed by every concrete
 * `StorageProvider` we ship with (bun-sqlite, knex) even though they don't
 * appear on the `WalletStorageProvider` interface.
 */
interface StorageWithFinders {
	findTransactions(args: {
		partial: { reference?: string; userId?: number }
		noRawTx?: boolean
		status?: string[]
	}): Promise<Array<{ transactionId: number; reference: string; userId: number }>>
	findOutputs(args: {
		partial: { transactionId?: number; userId?: number }
		noScript?: boolean
	}): Promise<
		Array<{
			transactionId: number
			vout: number
			satoshis: number
			lockingScript?: number[]
		}>
	>
}

/**
 * Server-issued next-payment derivation for an identity. Prefix is constant;
 * suffix is the monotonic count of payments already recorded for the
 * identity (first payment uses "0").
 */
export async function nextPaymentDerivation(
	identityKey: IdentityKey,
	repo: AccountsRepo,
): Promise<NextPaymentDerivation> {
	const count = await repo.countPayments(identityKey)
	return {
		derivationPrefix: PAYMENT_DERIVATION_PREFIX,
		derivationSuffix: String(count),
	}
}

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
 * Derive the P2PKH locking script that the sender is expected to pay to for
 * the given derivation suffix. Uses the server wallet's BRC-29 key
 * derivation — trust rooted entirely in server-side state.
 */
async function deriveExpectedPaymentScript(
	serverWallet: WalletInterface,
	senderIdentityKey: IdentityKey,
	expected: NextPaymentDerivation,
): Promise<string> {
	const { publicKey } = await serverWallet.getPublicKey({
		protocolID: BRC29_PROTOCOL_ID,
		keyID: `${expected.derivationPrefix} ${expected.derivationSuffix}`,
		counterparty: senderIdentityKey,
		forSelf: true,
	})
	const address = PublicKey.fromString(publicKey).toAddress()
	return new P2PKH().lock(address).toHex()
}

/**
 * True iff this createAction describes a valid self-payment: has the
 * `account-payment:<serverIdentityKey>` label, has a bounded number of
 * outputs, and includes one output whose `lockingScript` matches the
 * server's expected BRC-29 script and carries sats ≥ minSats.
 *
 * We never trust client-supplied `customInstructions` here — the expected
 * script is derived from server state (identity keys + next suffix).
 */
async function isCreateActionBypass(
	params: unknown[],
	senderIdentityKey: IdentityKey,
	serverIdentityKey: IdentityKey,
	serverWallet: WalletInterface,
	expected: NextPaymentDerivation,
	minSats: number,
): Promise<boolean> {
	const args = (params?.[1] ?? {}) as { labels?: unknown; outputs?: unknown }

	const labels = Array.isArray(args.labels) ? (args.labels as string[]) : []
	const expectedLabel = `account-payment:${serverIdentityKey}`
	console.error('[gate:createAction] labels=', labels, 'expectedLabel=', expectedLabel)
	if (!labels.includes(expectedLabel)) return false

	const outputs = Array.isArray(args.outputs)
		? (args.outputs as Array<{
				lockingScript?: unknown
				satoshis?: unknown
			}>)
		: []
	console.error('[gate:createAction] outputs.length=', outputs.length)
	if (
		outputs.length === 0 ||
		outputs.length > MAX_OUTPUTS_IN_BYPASSED_CREATE_ACTION
	) {
		return false
	}

	let expectedScript: string
	try {
		expectedScript = await deriveExpectedPaymentScript(
			serverWallet,
			senderIdentityKey,
			expected,
		)
	} catch (err) {
		console.error('[gate:createAction] derive err:', err)
		return false
	}
	console.error('[gate:createAction] expectedScript=', expectedScript, 'minSats=', minSats)

	for (const output of outputs) {
		console.error('[gate:createAction] output:', {
			scriptType: typeof output.lockingScript,
			scriptLen: typeof output.lockingScript === 'string' ? output.lockingScript.length : 0,
			script: typeof output.lockingScript === 'string' ? output.lockingScript : null,
			satoshis: output.satoshis,
		})
		if (
			typeof output.lockingScript === 'string' &&
			typeof output.satoshis === 'number' &&
			output.lockingScript === expectedScript &&
			output.satoshis >= minSats
		) {
			return true
		}
	}
	return false
}

/**
 * True iff this processAction refers to an action whose stored outputs
 * contain a valid self-payment to the server. The action must belong to the
 * authenticated user; we re-derive the expected script from server state
 * and match against the persisted lockingScript bytes.
 */
async function isProcessActionBypass(
	params: unknown[],
	senderIdentityKey: IdentityKey,
	userId: number,
	serverWallet: WalletInterface,
	walletStorage: WalletStorageProvider,
	expected: NextPaymentDerivation,
	minSats: number,
): Promise<boolean> {
	const args = (params?.[1] ?? {}) as { reference?: unknown }
	if (typeof args.reference !== 'string' || args.reference.length === 0) {
		return false
	}

	const storage = walletStorage as unknown as StorageWithFinders
	let transactionId: number | undefined
	try {
		const txs = await storage.findTransactions({
			partial: { reference: args.reference, userId },
			noRawTx: true,
		})
		transactionId = txs[0]?.transactionId
	} catch {
		return false
	}
	if (transactionId == null) return false

	let outputs: Array<{ satoshis: number; lockingScript?: number[] }>
	try {
		outputs = await storage.findOutputs({
			partial: { transactionId, userId },
		})
	} catch {
		return false
	}

	let expectedScriptHex: string
	try {
		expectedScriptHex = await deriveExpectedPaymentScript(
			serverWallet,
			senderIdentityKey,
			expected,
		)
	} catch {
		return false
	}

	for (const output of outputs) {
		if (!output.lockingScript || output.satoshis < minSats) continue
		const storedHex = Utils.toHex(output.lockingScript)
		if (storedHex === expectedScriptHex) return true
	}
	return false
}

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

			const nextPayment = await nextPaymentDerivation(identityKey, deps.repo)
			const params = (req.body as { params?: unknown[] })?.params ?? []

			if (method === 'createAction') {
				if (
					await isCreateActionBypass(
						params,
						identityKey,
						deps.serverIdentityKey,
						deps.wallet,
						nextPayment,
						quote.chargeSats,
					)
				) {
					return next()
				}
			} else if (method === 'processAction') {
				if (
					await isProcessActionBypass(
						params,
						identityKey,
						userId,
						deps.wallet,
						deps.walletStorage,
						nextPayment,
						quote.chargeSats,
					)
				) {
					return next()
				}
			}

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
						nextPayment,
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
