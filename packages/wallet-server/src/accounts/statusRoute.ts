import type { WalletInterface } from '@bsv/sdk'
import { useLogger } from 'evlog/express'
import type { Express, Request, Response } from 'express'
import type { WalletStorageProvider } from '../types.js'
import type { HandleCertStore } from './certs.js'
import {
	latestActivePaymentForPayer,
	nextPaymentDerivation,
} from './queries.js'
import { registrationStatus } from './registrationRoutes.js'
import type { AccountStore } from './store.js'
import type { WalletServerAccounts } from './types.js'

export interface StatusRouteDeps {
	storage: WalletStorageProvider
	serverIdentityKey: string
	wallet: WalletInterface
	accounts?: WalletServerAccounts
	accountStore?: AccountStore
	handleCertStore?: HandleCertStore
}

type AuthenticatedRequest = Request & { auth?: { identityKey: string } }

/** GET /account/status — per-identity usage, capacity, pricing and registration. */
export function mountStatusRoute(app: Express, deps: StatusRouteDeps): void {
	app.get(
		'/account/status',
		async (req: AuthenticatedRequest, res: Response) => {
			const log = useLogger()
			log.set({ context: 'wallet-server', route: 'account_status' })

			const identityKey = req.auth?.identityKey
			if (!identityKey || identityKey === 'unknown') {
				log.set({ event: 'auth_failed', reason: 'missing_identity' })
				return res.status(401).json({ error: 'Unauthenticated' })
			}
			log.set({ identityKey })

			const { serverIdentityKey } = deps
			const registration = await registrationStatus(
				deps.accountStore,
				identityKey,
				deps.handleCertStore,
			)

			const accounts = deps.accounts
			if (!accounts) {
				return res.status(200).json({
					identityKey,
					serverIdentityKey,
					accountsEnabled: false,
					...registration,
				})
			}

			const accountsConfig = accounts.getConfig()
			const currentBlock = await accounts.currentBlock()
			const userResult = await deps.storage.findOrInsertUser(identityKey)
			const userId = userResult?.user?.userId
			const usedBytes =
				userId == null
					? 0
					: await (
							deps.storage as unknown as {
								measureUsedBytes(userId: number): Promise<number>
							}
						).measureUsedBytes(userId)

			if (!accountsConfig.enabled) {
				return res.status(200).json({
					identityKey,
					serverIdentityKey,
					accountsEnabled: false,
					currentBlock,
					usedBytes,
					...registration,
				})
			}

			const currentPayment = await latestActivePaymentForPayer(
				deps.wallet,
				identityKey,
				currentBlock,
			)
			const paidBytes = currentPayment?.bytesCovered ?? 0
			const capacityBytes = accountsConfig.baselineBytes + paidBytes
			const deficitBytes = Math.max(0, usedBytes - capacityBytes)

			const nextPayment = await nextPaymentDerivation(identityKey, deps.wallet)

			return res.status(200).json({
				identityKey,
				serverIdentityKey,
				accountsEnabled: true,
				currentBlock,
				usedBytes,
				baselineBytes: accountsConfig.baselineBytes,
				paidBytes,
				capacityBytes,
				deficitBytes,
				paidThroughBlock: currentPayment?.paidThroughBlock ?? null,
				pricing: {
					purchaseUnitBytes: accountsConfig.purchaseUnitBytes,
					satsPerUnit: accountsConfig.satsPerUnit,
					durationBlocks: accountsConfig.durationBlocks,
				},
				nextPayment,
				...registration,
			})
		},
	)
}
