import type { WalletInterface } from '@bsv/sdk'
import { Random, Utils } from '@bsv/sdk'
import { isBillableMethod } from '../dispatch'
import type {
	JsonRpcResponse,
	ResolvedIdentity,
	WalletStorageProvider,
} from '../types'
import {
	Brc0121PaymentError,
	internalizePayment,
	parseBrc0121Payment,
	readBrc0121Headers,
} from './paymentValidation'
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

export interface BillabilityCheckInput {
	method: string
	identity: ResolvedIdentity
	request: Request
	id: string | number | null
}

export type BillabilityDecision =
	| { type: 'allow' }
	| { type: 'blocked'; response: Response }

/**
 * Gate that runs before dispatch for each JSON-RPC call. Decides whether to
 * allow the call, to return a 402 challenge, or to accept a payment and then
 * allow.
 */
export class AccountsGate {
	readonly repo: AccountsRepo
	private readonly freeKeys: Set<IdentityKey>

	constructor(private readonly deps: AccountsMiddlewareDeps) {
		this.repo = deps.repo
		this.freeKeys = new Set([
			deps.serverIdentityKey,
			...(deps.config.freeIdentityKeys ?? []),
		])
	}

	async check(input: BillabilityCheckInput): Promise<BillabilityDecision> {
		if (!this.deps.config.enabled) return { type: 'allow' }
		if (!isBillableMethod(input.method)) return { type: 'allow' }
		if (this.freeKeys.has(input.identity.identityKey)) return { type: 'allow' }

		const userId = await this.resolveUserId(input.identity.identityKey)
		if (userId == null) {
			// No wallet-toolbox user yet means zero bytes stored. Allow the first
			// billable request so the user row can be created; metering starts
			// from the next request.
			return { type: 'allow' }
		}

		const currentBlock = await this.deps.currentBlock()
		const used = await this.repo.measureUsedBytes(userId)
		const currentPayment = await this.repo.getCurrentPayment(
			input.identity.identityKey,
			currentBlock,
		)
		const quote = quoteRefundedCharge({
			usedBytes: used,
			currentPayment,
			currentBlock,
			config: this.deps.config,
		})

		if (!quote) return { type: 'allow' }

		const paymentHeaders = readBrc0121Headers(input.request)
		if (!paymentHeaders) {
			return { type: 'blocked', response: this.buildChallenge(input.id, quote) }
		}

		try {
			const parsed = parseBrc0121Payment(paymentHeaders, quote.chargeSats)
			if (await this.repo.paymentExists(parsed.txid)) {
				return {
					type: 'blocked',
					response: errorResponse(input.id, -32001, 'payment already applied'),
				}
			}
			const validation = await internalizePayment({
				wallet: this.deps.wallet,
				senderIdentityKey: input.identity.identityKey,
				parsed,
			})
			await this.repo.upsertAccount(input.identity.identityKey)
			await this.repo.recordPayment({
				identityKey: input.identity.identityKey,
				txid: validation.txid,
				bytesCovered: quote.bytesCovered,
				satsPaid: validation.satoshisReceived,
				paidThroughBlock: quote.paidThroughBlock,
			})
			return { type: 'allow' }
		} catch (err) {
			if (err instanceof Brc0121PaymentError) {
				return {
					type: 'blocked',
					response: errorResponse(input.id, -32002, err.message),
				}
			}
			throw err
		}
	}

	private async resolveUserId(
		identityKey: IdentityKey,
	): Promise<number | undefined> {
		const result = await this.deps.walletStorage.findOrInsertUser(identityKey)
		return result?.user?.userId
	}

	private buildChallenge(
		id: string | number | null,
		quote: RefundedQuote,
	): Response {
		const orderID = Utils.toBase64(Random(16))
		const derivationPrefix = Utils.toBase64(Random(16))
		const body = {
			jsonrpc: '2.0',
			error: {
				code: -32000,
				message: 'payment required',
				data: {
					status: 'payment-required',
					satoshisRequired: quote.chargeSats,
					fullSats: quote.fullSats,
					refundSats: quote.refundSats,
					bytesRequested: quote.bytesCovered,
					gigabytesCharged: quote.gigabytesCharged,
					paidThroughBlock: quote.paidThroughBlock,
					derivationPrefix,
					orderID,
				},
			},
			id,
		} satisfies JsonRpcResponse

		return new Response(JSON.stringify(body), {
			status: 402,
			headers: {
				'content-type': 'application/json',
				'x-bsv-payment-order-id': orderID,
				'x-bsv-payment-derivation-prefix': derivationPrefix,
				'x-bsv-payment-satoshis-required': String(quote.chargeSats),
			},
		})
	}
}

function errorResponse(
	id: string | number | null,
	code: number,
	message: string,
): Response {
	const body: JsonRpcResponse = {
		jsonrpc: '2.0',
		error: { code, message },
		id,
	}
	return new Response(JSON.stringify(body), {
		status: 402,
		headers: { 'content-type': 'application/json' },
	})
}
