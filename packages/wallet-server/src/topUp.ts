/**
 * Top-up helper: buys capacity on a remote wallet-server by building a
 * BRC-29 self-payment createAction. The server's accounts gate recognises
 * the self-payment, bypasses the 507, and auto-internalizes the payment
 * into its own wallet as part of processAction post-dispatch — so the
 * client never needs a second HTTP round-trip.
 *
 * Shared by the CLI `1sat remote topup` command and the eventual
 * factory-level auto-retry.
 */

import {
	P2PKH,
	PublicKey,
	type WalletInterface,
} from '@bsv/sdk'
import type { AccountStatusResponse } from './accounts/types'
import { WalletServerClient } from './client'

/** BRC-29 protocol ID for wallet payments (mirrors `@1sat/types`). */
const BRC29_PROTOCOL_ID: [2, string] = [2, '3241645161d8']

export interface TopUpOptions {
	/** Buy this many purchase units. Defaults to `ceil(deficit / unitBytes)`. */
	units?: number
	/** Reuse an existing client. Defaults to a fresh instance from `remoteUrl`. */
	client?: WalletServerClient
}

export interface TopUpResult {
	unitsBought: number
	satsPaid: number
	txid: string
	/** Account status after the payment is recorded. */
	status: AccountStatusResponse
}

export async function topUpStorage(
	wallet: WalletInterface,
	remoteUrl: string,
	options: TopUpOptions = {},
): Promise<TopUpResult> {
	const client =
		options.client ?? new WalletServerClient(remoteUrl, wallet)

	const status = await client.accountStatus()
	if (!status.accountsEnabled) {
		throw new Error(
			'remote has accounts metering disabled — no topup possible',
		)
	}

	const units =
		options.units ??
		Math.ceil(status.deficitBytes / status.pricing.purchaseUnitBytes)
	if (units <= 0) {
		throw new Error(
			`no topup needed — deficit is ${status.deficitBytes} bytes`,
		)
	}

	const sats = units * status.pricing.satsPerUnit
	const { derivationPrefix, derivationSuffix } = status.nextPayment
	const keyID = `${derivationPrefix} ${derivationSuffix}`

	const { publicKey } = await wallet.getPublicKey({
		protocolID: BRC29_PROTOCOL_ID,
		keyID,
		counterparty: status.serverIdentityKey,
		forSelf: false,
	})
	const address = PublicKey.fromString(publicKey).toAddress()
	const lockingScript = new P2PKH().lock(address).toHex()

	const createResult = await wallet.createAction({
		description: `wallet-server storage payment (${units} unit${units === 1 ? '' : 's'})`,
		labels: [`account-payment:${status.serverIdentityKey}`],
		outputs: [
			{
				lockingScript,
				satoshis: sats,
				outputDescription: 'storage capacity payment',
				customInstructions: JSON.stringify({
					derivationPrefix,
					derivationSuffix,
				}),
			},
		],
		options: {
			randomizeOutputs: false,
			acceptDelayedBroadcast: false,
		},
	})

	if (!createResult.txid) {
		throw new Error('createAction did not return a broadcast txid')
	}

	const newStatus = await client.accountStatus()

	return {
		unitsBought: units,
		satsPaid: sats,
		txid: createResult.txid,
		status: newStatus,
	}
}
