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
 * The consent hook shape is deliberately minimal for now — the full
 * consent/approval UX is designed in a later pass. Today the hook exists
 * only as a seam: callers who don't supply one get the default auto-pay
 * behavior (which is correct for test CLIs and for an already-consented
 * yours-wallet active remote).
 */

import {
	P2PKH,
	PublicKey,
	type WalletInterface,
	type CreateActionArgs,
	type CreateActionResult,
	type SignActionArgs,
	type SignActionResult,
	type InternalizeActionArgs,
	type InternalizeActionResult,
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
			if (!info) throw err
			const hook = config.onStoragePaymentRequired
			const ok = hook ? await hook(info) : true
			if (!ok) throw err
			await buildAndBroadcastPayment(originalCreateAction, wallet, info)
			return await op()
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
	const units = Math.ceil(
		info.deficitBytes / info.pricing.purchaseUnitBytes,
	)
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
