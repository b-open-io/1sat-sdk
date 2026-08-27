/**
 * Factory-level 507 auto-retry. Wraps `wallet.createAction`, `signAction`,
 * and `internalizeAction` so that when the active remote returns a 507
 * Insufficient Storage, we:
 *
 *   1. Consult an optional consent hook (default: auto-pay).
 *   2. Fetch current pricing + next-payment derivation from the remote's
 *      `/account/status` (the 507 body is not visible to the client
 *      because `StorageClient.rpcCall` only preserves HTTP status text).
 *   3. Build + broadcast a BRC-29 self-payment via the *unwrapped*
 *      `createAction` (so we don't re-enter our own retry logic).
 *   4. Retry the original operation.
 *
 * `installStorageClientPaymentAutoRetry` applies the same pattern to
 * `processSyncChunk` on a specific `StorageClient`, for sync writes to
 * backups (or from a peer active to this client).
 *
 * The consent hook shape is deliberately minimal for now — the full
 * consent/approval UX is designed in a later pass. Today the hook exists
 * only as a seam: callers who don't supply one get the default auto-pay
 * behavior (which is correct for test CLIs and for an already-consented
 * yours-wallet active remote).
 */

import {
	type CreateActionArgs,
	type CreateActionResult,
	type InternalizeActionArgs,
	type InternalizeActionResult,
	P2PKH,
	PublicKey,
	type SignActionArgs,
	type SignActionResult,
	type WalletInterface,
} from '@bsv/sdk'
import { AuthFetch } from '@bsv/sdk/auth'

/** BRC-29 protocol ID for wallet payments. */
const BRC29_PROTOCOL_ID: [2, string] = [2, '3241645161d8']

/**
 * Minimal view of the `/account/status` payload this layer needs. Full
 * shape lives in `@1sat/wallet-server`; depending on that package here
 * would create a circular dependency.
 */
interface AccountStatusEnabledShape {
	identityKey: string
	serverIdentityKey: string
	accountsEnabled: true
	currentBlock: number
	usedBytes: number
	baselineBytes: number
	paidBytes: number
	capacityBytes: number
	deficitBytes: number
	paidThroughBlock: number | null
	pricing: {
		purchaseUnitBytes: number
		satsPerUnit: number
		durationBlocks: number
	}
	nextPayment: {
		derivationPrefix: string
		derivationSuffix: string
	}
}

/**
 * Information supplied to the consent hook when a 507 is encountered on
 * the active remote. Reflects the remote's current pricing state — future
 * consent logic may compare these fields to a stored consent record.
 */
export interface StoragePaymentRequiredInfo {
	remoteUrl: string
	serverIdentityKey: string
	deficitBytes: number
	satsRequired: number
	pricing: {
		purchaseUnitBytes: number
		satsPerUnit: number
		durationBlocks: number
	}
	nextPayment: {
		derivationPrefix: string
		derivationSuffix: string
	}
}

export type StoragePaymentHook = (
	info: StoragePaymentRequiredInfo,
) => Promise<boolean>

/**
 * Thrown by the factory's 507 auto-retry wrapper when a storage payment
 * attempt cannot complete. Distinguishes storage-payment failures from
 * ordinary wallet errors so callers can present a targeted message
 * ("couldn't cover the storage fee") rather than a generic wallet error.
 *
 * The most common concrete case is **insufficient funds to cover the
 * required storage payment** — in which the underlying wallet-toolbox
 * error is preserved in `cause`. Other cases: the user's
 * `onStoragePaymentRequired` hook returned false, the server rejected
 * the self-payment tx, or the original op still failed after the payment
 * was recorded.
 */
export class StoragePaymentError extends Error {
	readonly name = 'StoragePaymentError'
	/**
	 * Stable string code for framework-agnostic detection:
	 * `err?.code === 'storage-payment-failed'`. Use this if you don't
	 * want to import the class.
	 */
	readonly code = 'storage-payment-failed'
	/** Pricing + deficit snapshot at the time of the failure, if available. */
	readonly info?: StoragePaymentRequiredInfo

	constructor(
		message: string,
		options: { info?: StoragePaymentRequiredInfo; cause?: unknown } = {},
	) {
		super(message, { cause: options.cause })
		this.info = options.info
	}
}

export interface AutoRetryConfig {
	/** The wallet whose billable methods should be wrapped. */
	wallet: WalletInterface
	/**
	 * Returns the currently-active remote URL, or undefined if local is
	 * active (in which case no 507 is possible and no retry ever fires).
	 */
	getActiveRemoteUrl(): string | undefined
	/**
	 * Optional. Called when a 507 is seen on the active remote. Returns
	 * `true` to proceed with auto-funding, `false` to propagate the 507
	 * to the caller. Default when omitted: `true`. Full consent UX
	 * (pricing bounds, remembered approvals) layers on top of this hook
	 * in a later pass.
	 */
	onStoragePaymentRequired?: StoragePaymentHook
}

/**
 * Install the 507 auto-retry wrappers on the given wallet. Mutates the
 * wallet in-place so every caller of `wallet.createAction` / `signAction`
 * / `internalizeAction` goes through the retry path. Returns the wallet
 * for convenience.
 */
export function installStoragePaymentAutoRetry(
	config: AutoRetryConfig,
): WalletInterface {
	const { wallet } = config
	const originalCreateAction = wallet.createAction.bind(wallet) as (
		args: CreateActionArgs,
	) => Promise<CreateActionResult>
	const originalSignAction = wallet.signAction.bind(wallet) as (
		args: SignActionArgs,
	) => Promise<SignActionResult>
	const originalInternalizeAction = wallet.internalizeAction.bind(wallet) as (
		args: InternalizeActionArgs,
	) => Promise<InternalizeActionResult>

	const runWithRetry = async <T>(op: () => Promise<T>): Promise<T> => {
		try {
			return await op()
		} catch (err) {
			if (!isInsufficientStorageError(err)) throw err
			const url = config.getActiveRemoteUrl()
			if (!url) throw err
			const info = await fetchPaymentInfo(wallet, url)
			if (!info) {
				// 507 but /account/status says no deficit / accounts disabled
				// — weird mismatch, not a payment-affordability problem. Pass
				// the raw 507 through.
				throw err
			}
			const hook = config.onStoragePaymentRequired
			const ok = hook ? await hook(info) : true
			if (!ok) {
				throw new StoragePaymentError(
					'storage payment declined by consent hook',
					{ info, cause: err },
				)
			}
			try {
				await buildAndBroadcastPayment(originalCreateAction, wallet, info)
			} catch (paymentErr) {
				throw new StoragePaymentError(
					buildPaymentErrorMessage(paymentErr, info),
					{ info, cause: paymentErr },
				)
			}
			try {
				return await op()
			} catch (retryErr) {
				if (isInsufficientStorageError(retryErr)) {
					throw new StoragePaymentError(
						'storage payment recorded but the operation still failed with 507',
						{ info, cause: retryErr },
					)
				}
				throw retryErr
			}
		}
	}

	wallet.createAction = (args: CreateActionArgs) =>
		runWithRetry(() => originalCreateAction(args))
	wallet.signAction = (args: SignActionArgs) =>
		runWithRetry(() => originalSignAction(args))
	wallet.internalizeAction = (args: InternalizeActionArgs) =>
		runWithRetry(() => originalInternalizeAction(args))

	return wallet
}

/**
 * Minimal view of a StorageClient this installer needs. Kept structural so
 * the installer doesn't force a wallet-toolbox import into `@1sat/wallet`.
 */
export interface StorageClientLike {
	readonly endpointUrl: string
	processSyncChunk: (args: unknown, chunk: unknown) => Promise<unknown>
}

/**
 * Minimal structural view of `WalletStorageManager` — just the two
 * methods the auto-resync needs. Kept structural so `@1sat/wallet`
 * doesn't take a hard dep on wallet-toolbox types here.
 */
export interface StorageManagerLike {
	getAuth(): Promise<{
		identityKey: string
		userId?: number
		isActive?: boolean
	}>
	syncToWriter(auth: unknown, writer: unknown): Promise<unknown>
}

export interface StorageClientAutoRetryConfig {
	/** Storage client whose `processSyncChunk` should be wrapped. */
	client: StorageClientLike
	/**
	 * Wallet used by `AuthFetch` to (a) mutually-authenticate against the
	 * storage client's server and (b) build the BRC-29 payment it attaches
	 * in response to the 402 issued by `/account/payment`.
	 */
	wallet: WalletInterface
	/**
	 * Optional. When supplied, after a successful payment the wrapper
	 * immediately re-syncs to this one backup via
	 * `storage.syncToWriter(auth, client)`, skipping the wait for the
	 * next `BackupSync` monitor tick. Without it, recovery waits for the
	 * monitor cadence.
	 */
	storage?: StorageManagerLike
}

/**
 * Wrap `processSyncChunk` on a single `StorageClient`. On a 507 from the
 * backup, fire a payment to `POST {endpointUrl}/account/payment` out of
 * band (fire-and-forget, deferred so it runs outside any sync lock the
 * caller may hold) and re-throw the 507 so the current sync attempt
 * aborts cleanly. If `storage` is supplied, after payment succeeds we
 * also trigger a targeted `syncToWriter(auth, client)` so the next
 * update happens immediately instead of waiting for the monitor tick.
 *
 * We do NOT retry the sync op inline. Doing so would require calling
 * `wallet.createAction` (for the payment build) from inside the sync
 * lock, which deadlocks against the lock held by `updateBackups`.
 */
export function installStorageClientPaymentAutoRetry(
	config: StorageClientAutoRetryConfig,
): StorageClientLike {
	const { client, wallet, storage } = config
	const originalProcessSyncChunk = client.processSyncChunk.bind(client)
	const paymentUrl = joinUrl(client.endpointUrl, 'account/payment')

	// Re-entry guard: when our post-payment syncToWriter calls
	// `client.processSyncChunk`, don't re-wrap. If that sync somehow
	// 507s again, let it throw normally instead of firing another
	// payment + sync cycle.
	let suppressWrap = false

	const wrapped = async <T>(op: () => Promise<T>): Promise<T> => {
		try {
			return await op()
		} catch (err) {
			if (isInsufficientStorageError(err)) {
				setTimeout(() => {
					new AuthFetch(wallet)
						.fetch(paymentUrl, {
							method: 'POST',
							headers: { 'content-type': 'application/json' },
							body: JSON.stringify({}),
						})
						.then(async (response) => {
							if (!response.ok) return
							if (!storage) return
							try {
								const auth = await storage.getAuth()
								suppressWrap = true
								try {
									await storage.syncToWriter(auth, client)
								} finally {
									suppressWrap = false
								}
							} catch (resyncErr) {
								console.error(
									`[storagePayment] post-payment sync to ${client.endpointUrl} failed:`,
									resyncErr,
								)
							}
						})
						.catch((paymentErr) => {
							console.error(
								`[storagePayment] payment to ${client.endpointUrl} failed:`,
								paymentErr,
							)
						})
				}, 0)
			}
			throw err
		}
	}

	client.processSyncChunk = (args: unknown, chunk: unknown) => {
		if (suppressWrap) return originalProcessSyncChunk(args, chunk)
		return wrapped(() => originalProcessSyncChunk(args, chunk))
	}

	return client
}

function isInsufficientStorageError(err: unknown): boolean {
	if (!err || typeof err !== 'object') return false
	const msg = (err as { message?: unknown }).message
	if (typeof msg !== 'string') return false
	// StorageClient.rpcCall throws "network error 507 507" on non-ok HTTP.
	return /\bnetwork error 507\b/.test(msg)
}

async function fetchPaymentInfo(
	wallet: WalletInterface,
	remoteUrl: string,
): Promise<StoragePaymentRequiredInfo | undefined> {
	const authFetch = new AuthFetch(wallet)
	const statusUrl = joinUrl(remoteUrl, 'account/status')
	const response = await authFetch.fetch(statusUrl, { method: 'GET' })
	if (!response.ok) return undefined
	const status = (await response.json()) as
		| AccountStatusEnabledShape
		| { accountsEnabled: false }
	if (!('accountsEnabled' in status) || !status.accountsEnabled) {
		return undefined
	}
	if (status.deficitBytes <= 0) return undefined
	const units = Math.ceil(
		status.deficitBytes / status.pricing.purchaseUnitBytes,
	)
	const satsRequired = units * status.pricing.satsPerUnit
	return {
		remoteUrl,
		serverIdentityKey: status.serverIdentityKey,
		deficitBytes: status.deficitBytes,
		satsRequired,
		pricing: status.pricing,
		nextPayment: status.nextPayment,
	}
}

async function buildAndBroadcastPayment(
	createAction: (args: CreateActionArgs) => Promise<CreateActionResult>,
	wallet: WalletInterface,
	info: StoragePaymentRequiredInfo,
): Promise<void> {
	const units = Math.ceil(info.deficitBytes / info.pricing.purchaseUnitBytes)
	const keyID = `${info.nextPayment.derivationPrefix} ${info.nextPayment.derivationSuffix}`
	const { publicKey } = await wallet.getPublicKey({
		protocolID: BRC29_PROTOCOL_ID,
		keyID,
		counterparty: info.serverIdentityKey,
		forSelf: false,
	})
	const address = PublicKey.fromString(publicKey).toAddress()
	const lockingScript = new P2PKH().lock(address).toHex()

	const result = await createAction({
		description: `storage payment (${units} unit${units === 1 ? '' : 's'})`,
		labels: [`account-payment:${info.serverIdentityKey}`],
		outputs: [
			{
				lockingScript,
				satoshis: info.satsRequired,
				outputDescription: 'storage capacity payment',
				customInstructions: JSON.stringify({
					derivationPrefix: info.nextPayment.derivationPrefix,
					derivationSuffix: info.nextPayment.derivationSuffix,
				}),
			},
		],
		options: {
			randomizeOutputs: false,
			acceptDelayedBroadcast: false,
		},
	})

	if (!result.txid) {
		throw new Error(
			'storage auto-retry: payment createAction did not return a txid',
		)
	}
}

function joinUrl(base: string, path: string): string {
	const b = base.endsWith('/') ? base.slice(0, -1) : base
	const p = path.startsWith('/') ? path.slice(1) : path
	return `${b}/${p}`
}

function buildPaymentErrorMessage(
	cause: unknown,
	info: StoragePaymentRequiredInfo,
): string {
	const detail =
		cause && typeof cause === 'object' && 'message' in cause
			? String((cause as { message: unknown }).message)
			: ''
	const base = `failed to build storage payment (${info.satsRequired} sats)`
	return detail ? `${base}: ${detail}` : base
}
