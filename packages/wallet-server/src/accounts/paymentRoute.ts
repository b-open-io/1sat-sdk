/**
 * Out-of-band payment delivery for the backup sync case.
 *
 * Mounts `POST {basePath}/account/payment` with our BRC-41 payment
 * middleware (vendored copy of `@bsv/payment-express-middleware` with an
 * internalize hook added). The middleware handles the 402 handshake,
 * nonce verification, and internalizeAction. Our hook attaches the
 * accounts-ledger labels (`wallet-storage-payment`, `payer:<id>`,
 * `bytes:<n>`, `block:<n>`) so `listPaymentsForPayer` can find the
 * payment at `/account/status` time.
 *
 * Scope: only used for the backup path (sync writes). The active path
 * keeps its inline capacity-gate bypass + auto-internalize in
 * `accountsCapacityGate` because the active case has a structural
 * chicken-and-egg — paying the active with a tx built on the active.
 */

import type { WalletInterface } from '@bsv/sdk'
import type { Express, NextFunction, Request, Response } from 'express'
import { nextPaymentDerivation } from './middleware'
import { createAccountsPaymentMiddleware } from './paymentMiddleware'
import { quoteRefundedCharge } from './pricing'
import {
	blockLabel,
	bytesLabel,
	latestActivePaymentForPayer,
	PAYMENT_LABEL,
	payerLabel,
} from './queries'
import type {
	AccountStatusResponse,
	AccountsConfigProvider,
	IdentityKey,
} from './types'

interface StorageWithMeter {
	findOrInsertUser(identityKey: string): Promise<{ user: { userId: number } }>
	measureUsedBytes(userId: number): Promise<number>
}

export interface PaymentRouteDeps {
	getConfig: AccountsConfigProvider
	wallet: WalletInterface
	walletStorage: StorageWithMeter
	serverIdentityKey: IdentityKey
	currentBlock: () => Promise<number>
}

type AuthedRequest = Request & { auth?: { identityKey?: string } }

interface QuoteInfo {
	chargeSats: number
	bytesCovered: number
	paidThroughBlock: number
}

async function computeQuote(
	deps: PaymentRouteDeps,
	identityKey: IdentityKey,
): Promise<QuoteInfo | undefined> {
	const config = deps.getConfig()
	if (!config.enabled) return undefined
	if (deps.serverIdentityKey === identityKey) return undefined
	if (config.freeIdentityKeys?.includes(identityKey)) return undefined

	const userResult = await deps.walletStorage.findOrInsertUser(identityKey)
	const userId = userResult?.user?.userId
	if (userId == null) return undefined

	const currentBlock = await deps.currentBlock()
	const [usedBytes, currentPayment] = await Promise.all([
		deps.walletStorage.measureUsedBytes(userId),
		latestActivePaymentForPayer(deps.wallet, identityKey, currentBlock),
	])
	const quote = quoteRefundedCharge({
		usedBytes,
		currentPayment,
		currentBlock,
		config,
	})
	if (!quote) return undefined
	return {
		chargeSats: quote.chargeSats,
		bytesCovered: quote.bytesCovered,
		paidThroughBlock: quote.paidThroughBlock,
	}
}

async function buildAccountStatus(
	deps: PaymentRouteDeps,
	identityKey: IdentityKey,
): Promise<AccountStatusResponse> {
	const config = deps.getConfig()
	const currentBlock = await deps.currentBlock()
	const userResult = await deps.walletStorage.findOrInsertUser(identityKey)
	const userId = userResult?.user?.userId
	const usedBytes =
		userId == null ? 0 : await deps.walletStorage.measureUsedBytes(userId)

	if (!config.enabled) {
		return {
			identityKey,
			serverIdentityKey: deps.serverIdentityKey,
			accountsEnabled: false,
			currentBlock,
			usedBytes,
		}
	}

	const currentPayment = await latestActivePaymentForPayer(
		deps.wallet,
		identityKey,
		currentBlock,
	)
	const paidBytes = currentPayment?.bytesCovered ?? 0
	const capacityBytes = config.baselineBytes + paidBytes
	const deficitBytes = Math.max(0, usedBytes - capacityBytes)
	const nextPayment = await nextPaymentDerivation(identityKey, deps.wallet)

	return {
		identityKey,
		serverIdentityKey: deps.serverIdentityKey,
		accountsEnabled: true,
		currentBlock,
		usedBytes,
		baselineBytes: config.baselineBytes,
		paidBytes,
		capacityBytes,
		deficitBytes,
		paidThroughBlock: currentPayment?.paidThroughBlock ?? null,
		pricing: {
			purchaseUnitBytes: config.purchaseUnitBytes,
			satsPerUnit: config.satsPerUnit,
			durationBlocks: config.durationBlocks,
		},
		nextPayment,
	}
}

export function mountPaymentRoute(
	app: Express,
	basePath: string,
	deps: PaymentRouteDeps,
): void {
	const paymentPath = joinPath(basePath, 'account/payment')

	// Keyed by req — stashed during calculateRequestPrice, read in the
	// onPaymentInternalize hook to derive the accounts-ledger labels.
	const quoteByReq = new WeakMap<Request, QuoteInfo>()

	const paymentMw = createAccountsPaymentMiddleware({
		wallet: deps.wallet,
		calculateRequestPrice: async (req) => {
			const identityKey = (req as AuthedRequest).auth?.identityKey
			if (!identityKey || identityKey === 'unknown') return 0
			const quote = await computeQuote(deps, identityKey)
			if (!quote) return 0
			quoteByReq.set(req, quote)
			return quote.chargeSats
		},
		onPaymentInternalize: (req, defaults) => {
			const identityKey = (req as AuthedRequest).auth?.identityKey ?? ''
			const quote = quoteByReq.get(req)
			return {
				...defaults,
				description: 'wallet-server storage payment',
				labels: [
					PAYMENT_LABEL,
					payerLabel(identityKey),
					...(quote
						? [
								bytesLabel(quote.bytesCovered),
								blockLabel(quote.paidThroughBlock),
							]
						: []),
				],
			}
		},
	})

	app.post(
		paymentPath,
		paymentMw,
		async (req: AuthedRequest, res: Response, next: NextFunction) => {
			try {
				const identityKey = req.auth?.identityKey
				if (!identityKey || identityKey === 'unknown') {
					return res.status(401).json({
						status: 'error',
						code: 'ERR_UNAUTHENTICATED',
						description: 'Mutual-authenticated identity required.',
					})
				}
				return res.status(200).json(await buildAccountStatus(deps, identityKey))
			} catch (err) {
				next(err)
			}
		},
	)
}

function joinPath(basePath: string, sub: string): string {
	const trimmedBase = basePath.endsWith('/') ? basePath.slice(0, -1) : basePath
	const trimmedSub = sub.startsWith('/') ? sub.slice(1) : sub
	return trimmedBase === '' ? `/${trimmedSub}` : `${trimmedBase}/${trimmedSub}`
}
