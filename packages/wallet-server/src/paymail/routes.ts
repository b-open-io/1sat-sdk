/**
 * Mount bsvalias surface on the host app using @bsv/paymail PaymailRouter.
 * Public routes — no BRC-100 auth. Mounted before auth-scoped surfaces.
 */

import { OneSatServices } from '@1sat/client'
import {
	P2pPaymentDestinationRoute,
	PaymailClient,
	PaymailRouter,
	PublicKeyInfrastructureRoute,
	PublicProfileRoute,
	ReceiveBeefTransactionRoute,
	ReceiveTransactionRoute,
} from '@bsv/paymail'
import { Transaction, Utils } from '@bsv/sdk'
import type { Express } from 'express'
import { createPaymentDestination, verifyPaymentOutputs } from './destination'
import { checkHostingEntitlement } from './entitlement'
import { MessageBoxClient } from './messagebox'
import { resolvePaymailBind } from './resolve'
import type { PaymailDeps } from './types'

class NotFoundError extends Error {
	constructor(message = 'paymail not found') {
		super(message)
		this.name = 'NotFoundError'
	}
}

export async function mountPaymailRoutes(
	app: Express,
	deps: PaymailDeps,
): Promise<void> {
	const services = new OneSatServices('main', deps.stackUrl)
	const gateOn = deps.requireEntitlement === true && deps.hostWallet != null
	const messageBox =
		deps.messageboxUrl && deps.hostPrivateKey
			? MessageBoxClient.fromPrivateKey(deps.messageboxUrl, deps.hostPrivateKey)
			: null
	if (deps.messageboxUrl && !deps.hostPrivateKey) {
		console.warn(
			'[paymail] messageboxUrl set without hostPrivateKey — inbox delivery disabled',
		)
	}

	async function resolveAndAuthorize(alias: string) {
		try {
			const bind = await resolvePaymailBind(services, alias)
			if (gateOn && deps.hostWallet) {
				const ent = await checkHostingEntitlement(
					deps.hostWallet,
					bind.identityKey,
				)
				if (!ent.active) {
					console.warn(
						`[paymail] ${alias}: identity ${bind.identityKey} has no active hosting subscription`,
					)
					throw new NotFoundError()
				}
			}
			return bind
		} catch (err) {
			if (err instanceof NotFoundError) throw err
			console.warn(
				`[paymail] ${alias}: bind resolution failed: ${err instanceof Error ? err.message : String(err)}`,
			)
			throw new NotFoundError()
		}
	}

	const paymailClient = new PaymailClient()
	const router = new PaymailRouter({
		baseUrl: deps.baseUrl,
		basePath: '/bsvalias',
		routes: [
			new PublicKeyInfrastructureRoute({
				domainLogicHandler: async (params: any) => {
					const { name, domain } =
						PublicKeyInfrastructureRoute.getNameAndDomain(params)
					const bind = await resolveAndAuthorize(name)
					return {
						bsvalias: '1.0' as const,
						handle: `${name}@${domain}`,
						pubkey: bind.identityKey,
					}
				},
			}),
			new PublicProfileRoute({
				domainLogicHandler: async (params: any) => {
					const { name } = PublicProfileRoute.getNameAndDomain(params)
					return { name, avatar: '' }
				},
			}),
			new P2pPaymentDestinationRoute({
				domainLogicHandler: async (params, body) => {
					const { name, domain } =
						P2pPaymentDestinationRoute.getNameAndDomain(params)
					const bind = await resolveAndAuthorize(name)
					const pending = await createPaymentDestination(deps.pendingStore, {
						alias: name,
						domain,
						identityPubKey: bind.identityKey,
						satoshis: Number(body.satoshis ?? 0),
						ttlMs: deps.pendingTtlMs,
					})
					return {
						reference: pending.reference,
						outputs: [
							{ satoshis: pending.satoshis, script: pending.outputScript },
						],
					}
				},
			}),
			new ReceiveBeefTransactionRoute({
				verifySignature: false,
				paymailClient,
				domainLogicHandler: async (params, body) => {
					const beefBytes = Utils.toArray(body.beef, 'hex')
					const tx = Transaction.fromAtomicBEEF(beefBytes)
					return finishReceive(tx, beefBytes, body.reference)
				},
			}),
			new ReceiveTransactionRoute({
				verifySignature: false,
				paymailClient,
				domainLogicHandler: async (params, body) => {
					const tx = Transaction.fromHex(body.hex)
					await populateAncestors(tx)
					const beefBytes = tx.toAtomicBEEF()
					return finishReceive(tx, beefBytes, body.reference)
				},
			}),
		],
		errorHandler: (err, req, res, next) => {
			if (err instanceof NotFoundError) {
				console.warn(`[paymail] 404 ${req.method} ${req.path}: ${err.message}`)
				return res.status(404).json({ error: 'paymail not found' })
			}
			// Terminal error middleware logs it with the request context.
			next(err)
		},
	})

	async function populateAncestors(tx: Transaction): Promise<void> {
		for (const input of tx.inputs) {
			if (input.sourceTransaction) continue
			const sourceTxid = input.sourceTXID
			if (!sourceTxid) throw new Error('input missing sourceTXID')
			const beefBytes = await services.beef.getBeef(sourceTxid)
			input.sourceTransaction = Transaction.fromBEEF(Array.from(beefBytes))
		}
	}

	async function finishReceive(
		tx: Transaction,
		beefBytes: number[],
		reference: string,
	): Promise<{ txid: string; note: string }> {
		const pending = await deps.pendingStore.get(reference)
		if (!pending) throw new NotFoundError('destination not found or expired')

		const scripts = tx.outputs.map((o) => o.lockingScript.toHex())
		const sats = tx.outputs.map((o) => o.satoshis ?? 0)
		const outputIndex = verifyPaymentOutputs(scripts, sats, pending)

		const status = await services.submitToStack(new Uint8Array(beefBytes))
		if (isRejected(status.txStatus)) {
			throw new Error('transaction rejected by network')
		}

		const txid = status.txid || tx.id('hex')
		pending.txid = txid
		await deps.pendingStore.update(pending)

		if (messageBox) {
			try {
				await messageBox.deliverPayment(
					Utils.toHex(beefBytes),
					outputIndex,
					pending,
				)
			} catch (err) {
				console.error('[paymail] messagebox delivery failed', err)
				throw new Error('failed to process payment')
			}
		}

		return { txid, note: 'Payment received' }
	}

	app.use(router.getRouter())
}

function isRejected(txStatus: string | undefined): boolean {
	return ['REJECTED', 'INVALID', 'DOUBLE_SPEND_ATTEMPTED'].includes(
		txStatus?.toUpperCase?.() ?? '',
	)
}
