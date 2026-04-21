/**
 * Express middleware for the accounts layer.
 *
 * `accountsCapacityGate(deps)` — runs between auth and dispatch. For
 * billable methods (createAction / processAction), inspects the call for a
 * valid self-payment output. If over-capacity, lets the call through only
 * if a valid self-payment is present. If a valid self-payment is present on
 * a `processAction`, schedules an auto-internalize after the response so
 * the received payment gets recorded into the server's own wallet with the
 * accounts-ledger labels. No separate `/account/payment` endpoint — one
 * client call is enough.
 */

import { Beef, P2PKH, PublicKey, type WalletInterface, Utils } from '@bsv/sdk'
import type { NextFunction, Request, Response } from 'express'
import { isBillableMethod } from '../dispatch'
import type { WalletStorageProvider } from '../types'
import { quoteRefundedCharge } from './pricing'
import {
	PAYMENT_LABEL,
	blockLabel,
	bytesLabel,
	countPaymentsForPayer,
	latestActivePaymentForPayer,
	payerLabel,
} from './queries'
import type {
	AccountsConfig,
	IdentityKey,
	NextPaymentDerivation,
} from './types'

/** BRC-29 protocol ID for wallet payments (matches @1sat/types constant). */
const BRC29_PROTOCOL_ID: [2, string] = [2, '3241645161d8']
/** Static derivation prefix tag (before base64 encoding). */
const PAYMENT_DERIVATION_PREFIX_TAG = 'wallet-storage'
/** Cap on non-change outputs allowed in a bypassed createAction, to stop
 * clients from smuggling unrelated work into the payment tx. */
const MAX_OUTPUTS_IN_BYPASSED_CREATE_ACTION = 2

function toBase64Prefix(prefix: string): string {
	return Utils.toBase64(Array.from(new TextEncoder().encode(prefix)))
}

function toBase64Suffix(index: number): string {
	return Utils.toBase64([
		(index >>> 24) & 0xff,
		(index >>> 16) & 0xff,
		(index >>> 8) & 0xff,
		index & 0xff,
	])
}

/**
 * Runtime storage surface used beyond the WalletStorageProvider interface.
 * Every concrete StorageProvider we ship with (bun-sqlite, knex) exposes
 * these; we just type them explicitly so call sites stay type-safe.
 */
interface StorageWithFinders {
	findTransactions(args: {
		partial: { txid?: string; reference?: string; userId?: number }
		noRawTx?: boolean
	}): Promise<
		Array<{
			transactionId: number
			reference: string
			userId: number
			txid?: string
		}>
	>
	findOutputs(args: {
		partial: { transactionId?: number; userId?: number }
	}): Promise<
		Array<{
			transactionId: number
			vout: number
			satoshis: number
			lockingScript?: number[]
		}>
	>
	/**
	 * Returns a fully-resolved `Beef` for the given txid. With `trustSelf`
	 * unset, walks each input's source recursively and expands txidOnly
	 * entries into full rawTx + merkle proof chains, producing a BEEF that
	 * can be binary-encoded as AtomicBEEF and passed to
	 * `wallet.internalizeAction`.
	 */
	getValidBeefForTxid(
		txid: string,
		mergeToBeef?: Beef,
		trustSelf?: 'known',
	): Promise<Beef | undefined>
	/**
	 * Driver-implemented: sum of stored bytes for a single user. Today
	 * provided by `StorageBunSqlite`; the forthcoming `StoragePg` supplies
	 * the equivalent over OCTET_LENGTH(bytea).
	 */
	measureUsedBytes(userId: number): Promise<number>
}

/**
 * Server-issued next-payment derivation for an identity. Prefix is constant;
 * suffix is the monotonic count of payments already recorded for the
 * identity (first payment uses "0").
 */
export async function nextPaymentDerivation(
	identityKey: IdentityKey,
	wallet: WalletInterface,
): Promise<NextPaymentDerivation> {
	const count = await countPaymentsForPayer(wallet, identityKey)
	return {
		derivationPrefix: toBase64Prefix(PAYMENT_DERIVATION_PREFIX_TAG),
		derivationSuffix: toBase64Suffix(count),
	}
}

export interface AccountsMiddlewareDeps {
	config: AccountsConfig
	walletStorage: WalletStorageProvider
	wallet: WalletInterface
	serverIdentityKey: IdentityKey
	/** Returns the current chain tip block height. */
	currentBlock: () => Promise<number>
}

type AuthedRequest = Request & { auth?: { identityKey?: string } }

/** JSON-RPC error code for "insufficient storage capacity". */
export const ERR_INSUFFICIENT_CAPACITY = -32005

interface BypassMatch {
	outputIndex: number
	satoshis: number
}

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
 * Returns match info (output index + satoshis) iff this createAction
 * describes a valid self-payment: has the `account-payment:<serverIdentity>`
 * label, bounded outputs, one output matching the server's expected BRC-29
 * script with satoshis ≥ minSats.
 *
 * Client-supplied customInstructions are never trusted — the expected script
 * is derived purely from server state (identity keys + next suffix).
 */
async function matchCreateActionPayment(
	params: unknown[],
	senderIdentityKey: IdentityKey,
	serverIdentityKey: IdentityKey,
	serverWallet: WalletInterface,
	expected: NextPaymentDerivation,
	minSats: number,
): Promise<BypassMatch | undefined> {
	const args = (params?.[1] ?? {}) as { labels?: unknown; outputs?: unknown }

	const labels = Array.isArray(args.labels) ? (args.labels as string[]) : []
	const expectedLabel = `account-payment:${serverIdentityKey}`
	if (!labels.includes(expectedLabel)) return undefined

	const outputs = Array.isArray(args.outputs)
		? (args.outputs as Array<{
				lockingScript?: unknown
				satoshis?: unknown
			}>)
		: []
	if (
		outputs.length === 0 ||
		outputs.length > MAX_OUTPUTS_IN_BYPASSED_CREATE_ACTION
	) {
		return undefined
	}

	let expectedScript: string
	try {
		expectedScript = await deriveExpectedPaymentScript(
			serverWallet,
			senderIdentityKey,
			expected,
		)
	} catch {
		return undefined
	}

	for (let i = 0; i < outputs.length; i++) {
		const output = outputs[i]
		if (
			typeof output.lockingScript === 'string' &&
			typeof output.satoshis === 'number' &&
			output.lockingScript === expectedScript &&
			output.satoshis >= minSats
		) {
			return { outputIndex: i, satoshis: output.satoshis }
		}
	}
	return undefined
}

/**
 * Returns match info iff this processAction refers to an action whose
 * stored outputs contain a valid self-payment to the server. The action
 * must belong to the authenticated user.
 */
async function matchProcessActionPayment(
	params: unknown[],
	senderIdentityKey: IdentityKey,
	userId: number,
	serverWallet: WalletInterface,
	walletStorage: WalletStorageProvider,
	expected: NextPaymentDerivation,
	minSats: number,
): Promise<BypassMatch | undefined> {
	const args = (params?.[1] ?? {}) as { reference?: unknown }
	if (typeof args.reference !== 'string' || args.reference.length === 0) {
		return undefined
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
		return undefined
	}
	if (transactionId == null) return undefined

	let outputs: Array<{ vout: number; satoshis: number; lockingScript?: number[] }>
	try {
		outputs = await storage.findOutputs({
			partial: { transactionId, userId },
		})
	} catch {
		return undefined
	}

	let expectedScriptHex: string
	try {
		expectedScriptHex = await deriveExpectedPaymentScript(
			serverWallet,
			senderIdentityKey,
			expected,
		)
	} catch {
		return undefined
	}

	for (const output of outputs) {
		if (!output.lockingScript || output.satoshis < minSats) continue
		const storedHex = Utils.toHex(output.lockingScript)
		if (storedHex === expectedScriptHex) {
			return { outputIndex: output.vout, satoshis: output.satoshis }
		}
	}
	return undefined
}

/**
 * After the client's processAction has broadcast the self-payment tx, this
 * records it in the SERVER's own wallet (internalize) with the structured
 * labels that the accounts ledger reads. Fired from `res.on('finish')` —
 * any failure here cannot be reported to the client, so it's logged.
 */
async function autoInternalizeSelfPayment(
	deps: AccountsMiddlewareDeps,
	ctx: {
		txid: string
		outputIndex: number
		payerIdentity: IdentityKey
		derivationPrefix: string
		derivationSuffix: string
		bytesCovered: number
		paidThroughBlock: number
	},
): Promise<void> {
	const storage = deps.walletStorage as unknown as StorageWithFinders
	// Build a fully-expanded AtomicBEEF for the broadcast tx. The persisted
	// per-tx inputBEEF uses txidOnly references (ancestors are "known to
	// storage"), which validateAtomicBeef rejects. getValidBeefForTxid
	// without trustSelf recurses through each input's source to produce a
	// BEEF with full rawTx + merkle proofs for all ancestors — the same
	// expansion signAction performs client-side.
	const beef = await storage.getValidBeefForTxid(ctx.txid)
	if (!beef) {
		throw new Error(`could not build BEEF for txid ${ctx.txid}`)
	}
	const atomicBeef = beef.toBinaryAtomic(ctx.txid)

	await deps.wallet.internalizeAction({
		tx: atomicBeef,
		outputs: [
			{
				paymentRemittance: {
					derivationPrefix: ctx.derivationPrefix,
					derivationSuffix: ctx.derivationSuffix,
					senderIdentityKey: ctx.payerIdentity,
				},
				outputIndex: ctx.outputIndex,
				protocol: 'wallet payment',
			},
		],
		labels: [
			PAYMENT_LABEL,
			payerLabel(ctx.payerIdentity),
			bytesLabel(ctx.bytesCovered),
			blockLabel(ctx.paidThroughBlock),
		],
		description: 'wallet-server storage payment',
	})
}

/**
 * Express middleware. Runs between auth and dispatch. For billable methods
 * when the caller is over capacity, short-circuits with 507 + quota info.
 * On processAction for a valid self-payment, schedules a post-response
 * auto-internalize so the payment is recorded in the server's wallet.
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

			const storage = deps.walletStorage as unknown as StorageWithFinders
			const currentBlock = await deps.currentBlock()
			const [usedBytes, currentPayment] = await Promise.all([
				storage.measureUsedBytes(userId),
				latestActivePaymentForPayer(deps.wallet, identityKey, currentBlock),
			])
			const quote = quoteRefundedCharge({
				usedBytes,
				currentPayment,
				currentBlock,
				config: deps.config,
			})
			if (!quote) return next()

			const nextPayment = await nextPaymentDerivation(identityKey, deps.wallet)
			const params = (req.body as { params?: unknown[] })?.params ?? []

			if (method === 'createAction') {
				const match = await matchCreateActionPayment(
					params,
					identityKey,
					deps.serverIdentityKey,
					deps.wallet,
					nextPayment,
					quote.chargeSats,
				)
				if (match) return next()
			} else if (method === 'processAction') {
				const match = await matchProcessActionPayment(
					params,
					identityKey,
					userId,
					deps.wallet,
					deps.walletStorage,
					nextPayment,
					quote.chargeSats,
				)
				if (match) {
					const processArgs = params[1] as {
						txid?: string
						reference?: string
					}
					if (typeof processArgs?.txid === 'string') {
						const ctx = {
							txid: processArgs.txid,
							outputIndex: match.outputIndex,
							payerIdentity: identityKey,
							derivationPrefix: nextPayment.derivationPrefix,
							derivationSuffix: nextPayment.derivationSuffix,
							bytesCovered: quote.bytesCovered,
							paidThroughBlock: quote.paidThroughBlock,
						}
						res.on('finish', () => {
							if (res.statusCode !== 200) return
							autoInternalizeSelfPayment(deps, ctx).catch((err) => {
								console.error(
									'[accounts] auto-internalize failed for',
									ctx.txid,
									err,
								)
							})
						})
					}
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
