/**
 * Hosting subscription routes on the wallet server.
 *
 * GET  /hosting/price   — public (mounted before global auth when possible)
 * GET  /hosting/status  — BRC-100 auth
 * POST /hosting/subscribe — BRC-100 auth + 402 → spend prior receipt(s), mint one new
 *
 * Receipt: 1-sat to host, basket HOSTING_BASKET, wallet-local tags only
 * (payer:{id}, exp:{unix}). No customer identity on-chain.
 * At most one live receipt set per identity: renew spends all prior.
 */

import {
	HOSTING_BASKET,
	hostingExpTag,
	hostingPayerTag,
	P1SAT_PROTOCOL,
	readHostingExp,
} from '@1sat/types'
import {
	Hash,
	P2PKH,
	PublicKey,
	Transaction,
	TransactionSignature,
	UnlockingScript,
	Utils,
	type WalletInterface,
	type WalletOutput,
	type WalletProtocol,
} from '@bsv/sdk'
import type { Express, NextFunction, Request, Response } from 'express'
import { createAccountsPaymentMiddleware } from '../accounts/paymentMiddleware'

export interface HostingConfig {
	enabled: boolean
	priceSats: number
	/** Operator's USD target price, surfaced verbatim on the pricing API. */
	priceUsd?: number
	periodSeconds: number
}

export type HostingConfigProvider = () => HostingConfig

type AuthedRequest = Request & { auth?: { identityKey?: string } }

export function mountHostingRoutes(
	app: Express,
	basePath: string,
	deps: {
		wallet: WalletInterface
		getConfig: HostingConfigProvider
		authMiddleware: (req: Request, res: Response, next: NextFunction) => unknown
	},
): void {
	const root = basePath === '/' ? '' : basePath.replace(/\/$/, '')
	// GET /hosting/price is mounted in createWalletServer *before* auth.

	app.get(
		`${root}/hosting/status`,
		deps.authMiddleware,
		async (req: AuthedRequest, res: Response) => {
			const cfg = deps.getConfig()
			const identityKey = req.auth?.identityKey
			if (!identityKey || identityKey === 'unknown') {
				return res.status(401).json({ error: 'unauthenticated' })
			}
			if (!cfg.enabled) {
				return res.json({
					enabled: false,
					identityKey,
					active: false,
				})
			}
			const status = await hostingStatus(deps.wallet, identityKey)
			return res.json({
				enabled: true,
				identityKey,
				...status,
				priceSats: cfg.priceSats,
				...(cfg.priceUsd !== undefined && { priceUsd: cfg.priceUsd }),
				periodSeconds: cfg.periodSeconds,
			})
		},
	)

	const paymentMw = createAccountsPaymentMiddleware({
		wallet: deps.wallet,
		calculateRequestPrice: async () => {
			const cfg = deps.getConfig()
			return cfg.enabled ? cfg.priceSats : 0
		},
		onPaymentInternalize: (_req, defaults) => ({
			...defaults,
			description: 'Hosted paymail subscription',
			labels: ['hosting-payment'],
		}),
	})

	app.post(
		`${root}/hosting/subscribe`,
		deps.authMiddleware,
		paymentMw,
		async (req: AuthedRequest, res: Response) => {
			const cfg = deps.getConfig()
			const identityKey = req.auth?.identityKey
			if (!identityKey || identityKey === 'unknown') {
				return res.status(401).json({ error: 'unauthenticated' })
			}
			if (!cfg.enabled) {
				return res.status(404).json({ error: 'hosting disabled' })
			}

			try {
				const result = await mintOrReplaceReceipt(
					deps.wallet,
					identityKey,
					cfg.periodSeconds,
				)
				return res.json({
					status: 'ok',
					identityKey,
					expiresAt: result.expiresAt,
					txid: result.txid,
				})
			} catch (err) {
				console.error('[hosting] mint receipt failed', err)
				return res.status(500).json({
					error: err instanceof Error ? err.message : 'mint failed',
				})
			}
		},
	)
}

async function listReceipts(
	wallet: WalletInterface,
	identityKey: string,
	withBeef: boolean,
): Promise<{ outputs: WalletOutput[]; BEEF?: number[] }> {
	const result = await wallet.listOutputs({
		basket: HOSTING_BASKET,
		tags: [hostingPayerTag(identityKey)],
		tagQueryMode: 'all',
		includeTags: true,
		includeCustomInstructions: true,
		...(withBeef ? { include: 'entire transactions' as const } : {}),
		limit: 100,
	})
	return {
		outputs: result.outputs,
		BEEF: result.BEEF ? Array.from(result.BEEF) : undefined,
	}
}

async function hostingStatus(
	wallet: WalletInterface,
	identityKey: string,
): Promise<{ active: boolean; expiresAt?: number }> {
	const { outputs } = await listReceipts(wallet, identityKey, false)
	const now = Math.floor(Date.now() / 1000)
	// After correct mint, at most one — still take max if legacy junk exists.
	let maxExp = 0
	for (const o of outputs) {
		const exp = readHostingExp(o.tags)
		if (exp !== undefined && exp > maxExp) maxExp = exp
	}
	return {
		active: maxExp > now,
		expiresAt: maxExp > 0 ? maxExp : undefined,
	}
}

/**
 * Spend all existing receipts for identity, create exactly one new receipt
 * with exp = max(now, priorExp) + periodSeconds.
 */
async function mintOrReplaceReceipt(
	wallet: WalletInterface,
	identityKey: string,
	periodSeconds: number,
): Promise<{ expiresAt: number; txid: string }> {
	const now = Math.floor(Date.now() / 1000)
	const { outputs: existing, BEEF } = await listReceipts(
		wallet,
		identityKey,
		true,
	)

	let priorExp = now
	for (const o of existing) {
		const exp = readHostingExp(o.tags)
		if (exp !== undefined && exp > priorExp) priorExp = exp
	}
	const expiresAt = priorExp + periodSeconds

	const keyID = `hosting-${expiresAt}-${identityKey.slice(0, 8)}`
	const { publicKey } = await wallet.getPublicKey({
		protocolID: P1SAT_PROTOCOL,
		keyID,
		counterparty: 'self',
		forSelf: true,
	})
	const lockingScript = new P2PKH()
		.lock(PublicKey.fromString(publicKey).toAddress())
		.toHex()

	const inputs = existing.map((o) => ({
		outpoint: o.outpoint,
		inputDescription: 'Replace hosting receipt',
		unlockingScriptLength: 108,
	}))

	const created = await wallet.createAction({
		description: 'Hosting subscription receipt',
		...(inputs.length > 0 && {
			inputs,
			inputBEEF: BEEF,
		}),
		outputs: [
			{
				lockingScript,
				satoshis: 1,
				outputDescription: 'Hosting receipt',
				basket: HOSTING_BASKET,
				tags: [hostingPayerTag(identityKey), hostingExpTag(expiresAt)],
				customInstructions: JSON.stringify({
					protocolID: P1SAT_PROTOCOL,
					keyID,
					counterparty: 'self',
				}),
			},
		],
		options: { randomizeOutputs: false },
	})

	if (!created.txid && !created.signableTransaction) {
		throw new Error('createAction returned no txid')
	}

	if (created.signableTransaction && existing.length > 0) {
		const tx = Transaction.fromAtomicBEEF(created.signableTransaction.tx)
		const spends: Record<number, { unlockingScript: string }> = {}
		for (let i = 0; i < existing.length; i++) {
			const o = existing[i]
			if (!o.customInstructions) {
				throw new Error(`missing customInstructions on ${o.outpoint}`)
			}
			const ci = JSON.parse(o.customInstructions) as {
				protocolID: WalletProtocol
				keyID: string
				counterparty?: string
			}
			const unlocking = await signP2PKH(
				wallet,
				tx,
				i,
				ci.protocolID,
				ci.keyID,
				ci.counterparty ?? 'self',
			)
			spends[i] = { unlockingScript: unlocking }
		}
		const signed = await wallet.signAction({
			reference: created.signableTransaction.reference,
			spends,
		})
		if (!signed.txid) throw new Error('signAction returned no txid')
		return { expiresAt, txid: signed.txid }
	}

	if (!created.txid) throw new Error('createAction returned no txid')
	return { expiresAt, txid: created.txid }
}

async function signP2PKH(
	wallet: WalletInterface,
	tx: Transaction,
	inputIndex: number,
	protocolID: WalletProtocol,
	keyID: string,
	counterparty: string,
): Promise<string> {
	const txInput = tx.inputs[inputIndex]
	const sourceLockingScript =
		txInput.sourceTransaction?.outputs[txInput.sourceOutputIndex]?.lockingScript
	if (!sourceLockingScript) {
		throw new Error(`missing source locking script for input ${inputIndex}`)
	}
	const sourceTXID = txInput.sourceTXID ?? txInput.sourceTransaction?.id('hex')
	if (!sourceTXID)
		throw new Error(`missing source txid for input ${inputIndex}`)
	const sourceSatoshis =
		txInput.sourceTransaction?.outputs[txInput.sourceOutputIndex]?.satoshis ?? 1

	const preimage = TransactionSignature.format({
		sourceTXID,
		sourceOutputIndex: txInput.sourceOutputIndex,
		sourceSatoshis,
		transactionVersion: tx.version,
		otherInputs: tx.inputs
			.filter((_, idx) => idx !== inputIndex)
			.map((inp) => ({
				sourceTXID: inp.sourceTXID ?? inp.sourceTransaction?.id('hex') ?? '',
				sourceOutputIndex: inp.sourceOutputIndex,
				sequence: inp.sequence ?? 0xffffffff,
			})),
		inputIndex,
		outputs: tx.outputs,
		inputSequence: txInput.sequence ?? 0xffffffff,
		subscript: sourceLockingScript,
		lockTime: tx.lockTime,
		scope:
			TransactionSignature.SIGHASH_ALL | TransactionSignature.SIGHASH_FORKID,
	})
	const sighash = Hash.sha256(Hash.sha256(preimage))
	const { signature } = await wallet.createSignature({
		protocolID,
		keyID,
		counterparty,
		data: Array.from(preimage),
		hashToDirectlySign: Array.from(sighash),
	})
	const { publicKey } = await wallet.getPublicKey({
		protocolID,
		keyID,
		counterparty,
		forSelf: true,
	})
	const sigWithHashtype = [
		...signature,
		TransactionSignature.SIGHASH_ALL | TransactionSignature.SIGHASH_FORKID,
	]
	return new UnlockingScript()
		.writeBin(sigWithHashtype)
		.writeBin(Utils.toArray(publicKey, 'hex'))
		.toHex()
}
