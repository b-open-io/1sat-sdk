/**
 * Out-of-band payment delivery for the backup sync case.
 *
 * Mounts `POST {basePath}/account/payment`, a BRC-41-style 402 flow that
 * mirrors `@bsv/payment-express-middleware` but internalizes the received
 * payment with the accounts-ledger labels (`wallet-storage-payment`,
 * `payer:<id>`, `bytes:<n>`, `block:<n>`) so `listPaymentsForPayer` can
 * find it later.
 *
 * Why not reuse the upstream middleware as-is: it internalizes with only
 * a description, no labels. Our accounting ledger is label-indexed, so a
 * label-less internalize goes unseen. The endpoint here keeps the same
 * 402 wire protocol (so client-side `AuthFetch` pays automatically) but
 * supplies the labels on internalize.
 *
 * Scope: only used for the backup path (sync writes). The active path
 * keeps its inline capacity-gate bypass + auto-internalize in
 * `accountsCapacityGate` because the active case has a structural
 * chicken-and-egg — paying the active with a tx built on the active —
 * that the inline bypass solves.
 */

import {
	type AtomicBEEF,
	createNonce,
	Utils,
	type WalletInterface,
	verifyNonce,
} from '@bsv/sdk'
import type {
	Express,
	NextFunction,
	Request,
	Response,
} from 'express'
import { quoteRefundedCharge } from './pricing'
import {
	PAYMENT_LABEL,
	blockLabel,
	bytesLabel,
	latestActivePaymentForPayer,
	payerLabel,
} from './queries'
import type { AccountsConfig, IdentityKey } from './types'

const PAYMENT_VERSION = '1.0'

interface StorageWithMeter {
	findOrInsertUser(identityKey: string): Promise<{ user: { userId: number } }>
	measureUsedBytes(userId: number): Promise<number>
}

export interface PaymentRouteDeps {
	config: AccountsConfig
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
	if (!deps.config.enabled) return undefined
	if (deps.serverIdentityKey === identityKey) return undefined
	if (deps.config.freeIdentityKeys?.includes(identityKey)) return undefined

	const userResult = await deps.walletStorage.findOrInsertUser(identityKey)
	const userId = userResult?.user?.userId
	if (userId == null) return undefined

	const [usedBytes, currentPayment, currentBlock] = await Promise.all([
		deps.walletStorage.measureUsedBytes(userId),
		latestActivePaymentForPayer(
			deps.wallet,
			identityKey,
			await deps.currentBlock(),
		),
		deps.currentBlock(),
	])

	const quote = quoteRefundedCharge({
		usedBytes,
		currentPayment,
		currentBlock,
		config: deps.config,
	})
	if (!quote) return undefined

	return {
		chargeSats: quote.chargeSats,
		bytesCovered: quote.bytesCovered,
		paidThroughBlock: quote.paidThroughBlock,
	}
}

export function mountPaymentRoute(
	app: Express,
	basePath: string,
	deps: PaymentRouteDeps,
): void {
	const paymentPath = joinPath(basePath, 'account/payment')
	app.post(
		paymentPath,
		async (req: AuthedRequest, res: Response, next: NextFunction) => {
			try {
				console.log('[payment] received POST', {
					identityKey: req.auth?.identityKey,
					hasPaymentHeader: req.headers['x-bsv-payment'] !== undefined,
				})
				const identityKey = req.auth?.identityKey
				if (!identityKey || identityKey === 'unknown') {
					return res.status(401).json({
						status: 'error',
						code: 'ERR_UNAUTHENTICATED',
						description: 'Mutual-authenticated identity required.',
					})
				}

				const quote = await computeQuote(deps, identityKey)
				console.log('[payment] quote', quote)
				if (!quote || quote.chargeSats === 0) {
					return res.status(200).json({
						status: 'ok',
						accountsEnabled: deps.config.enabled,
						chargeSats: 0,
					})
				}

				const bsvPaymentHeader = req.headers['x-bsv-payment']
				if (bsvPaymentHeader === undefined) {
					const derivationPrefix = await createNonce(deps.wallet)
					console.log('[payment] issuing 402', {
						derivationPrefix,
						satsRequired: quote.chargeSats,
					})
					return res
						.status(402)
						.set({
							'x-bsv-payment-version': PAYMENT_VERSION,
							'x-bsv-payment-satoshis-required': String(quote.chargeSats),
							'x-bsv-payment-derivation-prefix': derivationPrefix,
						})
						.json({
							status: 'error',
							code: 'ERR_PAYMENT_REQUIRED',
							satoshisRequired: quote.chargeSats,
							description:
								'BSV payment required. Retry with the X-BSV-Payment header.',
						})
				}

				let paymentData: {
					derivationPrefix: string
					derivationSuffix: string
					transaction: string
				}
				try {
					paymentData = JSON.parse(String(bsvPaymentHeader))
				} catch {
					return res.status(400).json({
						status: 'error',
						code: 'ERR_MALFORMED_PAYMENT',
						description: 'The X-BSV-Payment header is not valid JSON.',
					})
				}
				try {
					const valid = await verifyNonce(
						paymentData.derivationPrefix,
						deps.wallet,
					)
					if (!valid) throw new Error('invalid nonce')
				} catch {
					return res.status(400).json({
						status: 'error',
						code: 'ERR_INVALID_DERIVATION_PREFIX',
						description: 'The X-BSV-Payment-Derivation-Prefix is not valid.',
					})
				}

				try {
					await deps.wallet.internalizeAction({
						tx: Utils.toArray(
							paymentData.transaction,
							'base64',
						) as AtomicBEEF,
						outputs: [
							{
								paymentRemittance: {
									derivationPrefix: paymentData.derivationPrefix,
									derivationSuffix: paymentData.derivationSuffix,
									senderIdentityKey: identityKey,
								},
								outputIndex: 0,
								protocol: 'wallet payment',
							},
						],
						labels: [
							PAYMENT_LABEL,
							payerLabel(identityKey),
							bytesLabel(quote.bytesCovered),
							blockLabel(quote.paidThroughBlock),
						],
						description: 'wallet-server storage payment',
					})
				} catch (err) {
					const code = (err as { code?: string })?.code ?? 'ERR_PAYMENT_FAILED'
					const description =
						(err as { message?: string })?.message ?? 'Payment failed.'
					return res.status(400).json({
						status: 'error',
						code,
						description,
					})
				}

				return res
					.status(200)
					.set({
						'x-bsv-payment-satoshis-paid': String(quote.chargeSats),
					})
					.json({
						status: 'ok',
						bytesCovered: quote.bytesCovered,
						paidThroughBlock: quote.paidThroughBlock,
					})
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
