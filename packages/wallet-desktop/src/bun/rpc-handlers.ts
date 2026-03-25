/**
 * RPC request handlers — Bun side.
 *
 * Each handler matches a key in `BunRequests` (the `webview.requests`
 * section of the RPC schema). The WebView calls these via
 * `electroview.rpc.request.<name>(params)`.
 */
import {
	createContext,
	createSocialPost,
	getBsv21Balances,
	getLockData,
	getOpnsNames,
	getOrdinals,
	getProfile,
	inscribe,
	lockBsv,
	opnsDeregister,
	opnsRegister,
	publishIdentity,
	resolveBapId,
	sendBsv,
	sendBsv21,
	sweepBsv,
	unlockBsv,
} from '@1sat/actions'
import { OPNS_BASKET } from '@1sat/actions'
import { BRC29_PROTOCOL_ID } from '@1sat/types'
import { generateMnemonic, isValidMnemonic } from '@1sat/utils'
import { PrivateKey, PublicKey, Utils as SdkUtils, Transaction } from '@bsv/sdk'
import { Utils } from 'electrobun/bun'
import type {
	CreateSocialPostParams,
	FileReadResult,
	HistoryEntry,
	InscribeFileParams,
	LockBsvParams,
	LockDataInfo,
	MintCollectionItemParams,
	MintCollectionParams,
	OpnsNameInfo,
	OpnsOperationParams,
	OrdinalInfo,
	SendBsv21Params,
	SweepScanResult,
	TokenBalance,
} from '../shared/types'
import {
	fetchChannelMessages,
	getChatChannels,
	subscribeChannel,
	unsubscribeChannel,
} from './chat-manager'
import { getStackUrl, isStackRunning } from './sidecar-manager'
import {
	applyUpdate,
	checkForUpdatesManual,
	getAppVersionInfo,
} from './updater'
import {
	create,
	deleteWallet,
	getStatus,
	getWallet,
	lock,
	unlock,
} from './wallet-manager'

// ============================================================================
// MIME type lookup
// ============================================================================

const MIME_MAP: Record<string, string> = {
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.gif': 'image/gif',
	'.webp': 'image/webp',
	'.svg': 'image/svg+xml',
	'.mp3': 'audio/mpeg',
	'.mp4': 'video/mp4',
	'.webm': 'video/webm',
	'.json': 'application/json',
	'.txt': 'text/plain',
	'.html': 'text/html',
	'.css': 'text/css',
	'.js': 'application/javascript',
	'.pdf': 'application/pdf',
}

function guessMimeType(filename: string): string {
	const ext = filename.slice(filename.lastIndexOf('.')).toLowerCase()
	return MIME_MAP[ext] ?? 'application/octet-stream'
}

// ============================================================================
// Helpers
// ============================================================================

function requireWallet() {
	const w = getWallet()
	if (!w) {
		throw new Error('Wallet is not unlocked')
	}
	return w
}

// ============================================================================
// Handler map
// ============================================================================

/**
 * Returns the request handlers object to pass into `BrowserView.defineRPC`.
 * Each function signature matches the RPC schema params -> response contract.
 */
export function createRpcHandlers() {
	return {
		generateMnemonic: () => {
			return { mnemonic: generateMnemonic() }
		},

		getWalletStatus: () => {
			return { status: getStatus() }
		},

		createWallet: async ({
			mnemonic,
			passphrase,
		}: { mnemonic: string; passphrase?: string }) => {
			try {
				await create(mnemonic, passphrase ?? '')
				return { success: true }
			} catch (err) {
				return {
					success: false,
					error: err instanceof Error ? err.message : String(err),
				}
			}
		},

		importWallet: async ({
			mnemonic,
			passphrase,
		}: { mnemonic: string; passphrase?: string }) => {
			try {
				if (!isValidMnemonic(mnemonic)) {
					return { success: false, error: 'Invalid mnemonic phrase' }
				}
				await create(mnemonic, passphrase ?? '')
				return { success: true }
			} catch (err) {
				return {
					success: false,
					error: err instanceof Error ? err.message : String(err),
				}
			}
		},

		unlockWallet: async ({ passphrase }: { passphrase?: string } = {}) => {
			try {
				await unlock(passphrase ?? '')
				return { success: true }
			} catch (err) {
				return {
					success: false,
					error: err instanceof Error ? err.message : String(err),
				}
			}
		},

		lockWallet: async () => {
			await lock()
			return { success: true }
		},

		deleteWallet: async () => {
			try {
				await deleteWallet()
				return { success: true }
			} catch (err) {
				return {
					success: false,
					error: err instanceof Error ? err.message : String(err),
				}
			}
		},

		getBalance: async () => {
			const { wallet } = requireWallet()
			const result = await wallet.listOutputs({
				basket: 'default',
				include: 'locking scripts',
			})
			let confirmed = 0
			for (const output of result.outputs) {
				if (output.spendable) {
					confirmed += output.satoshis
				}
			}
			return { confirmed, unconfirmed: 0 }
		},

		getReceiveInfo: async () => {
			const { wallet } = requireWallet()
			const prefix = SdkUtils.toBase64(
				Array.from(new TextEncoder().encode('1sat')),
			)
			const suffix = SdkUtils.toBase64([0, 0, 0, 0])
			const { publicKey } = await wallet.getPublicKey({
				protocolID: BRC29_PROTOCOL_ID,
				keyID: `${prefix} ${suffix}`,
				forSelf: true,
			})
			const address = PublicKey.fromString(publicKey).toAddress()
			return { address }
		},

		sendBsv: async ({
			address,
			amount,
		}: { address: string; amount: number }) => {
			const w = requireWallet()
			const ctx = createContext(w.wallet, {
				services: w.services,
				chain: 'main',
			})
			const result = await sendBsv.execute(ctx, {
				requests: [{ address, satoshis: amount }],
			})
			if (result.error) {
				throw new Error(result.error)
			}
			return { txid: result.txid! }
		},

		getOrdinals: async ({
			limit,
			offset,
		}: { limit?: number; offset?: number } = {}) => {
			const w = requireWallet()
			const ctx = createContext(w.wallet, {
				services: w.services,
				chain: 'main',
			})
			const result = await getOrdinals.execute(ctx, {
				limit: limit ?? 100,
				offset: offset ?? 0,
			})
			const ordinals: OrdinalInfo[] = result.outputs.map((o) => ({
				outpoint: o.outpoint,
				tags: o.tags ?? [],
				satoshis: o.satoshis,
			}))
			return { ordinals }
		},

		getTokenBalances: async () => {
			console.log('[RPC] getTokenBalances called')
			const w = requireWallet()
			const ctx = createContext(w.wallet, {
				services: w.services,
				chain: 'main',
			})
			const balances = await getBsv21Balances.execute(ctx, {})
			const mapped: TokenBalance[] = balances.map((b) => ({
				id: b.id,
				sym: b.sym,
				icon: b.icon,
				dec: b.dec,
				amt: b.amt,
			}))
			console.log(`[RPC] getTokenBalances done: ${mapped.length} results`)
			return { balances: mapped }
		},

		getTransactionHistory: async ({
			limit,
			offset,
		}: { limit?: number; offset?: number } = {}) => {
			console.log('[RPC] getTransactionHistory called')
			const { wallet } = requireWallet()
			const result = await wallet.listActions({
				labels: [],
				limit: limit ?? 50,
				offset: offset ?? 0,
				includeLabels: true,
			})
			const entries: HistoryEntry[] = (result.actions ?? []).map((a) => ({
				txid: a.txid ?? '',
				description: a.description ?? '',
				satoshis: a.satoshis ?? 0,
				status: a.status ?? 'unknown',
				isOutgoing: a.isOutgoing ?? false,
				dateCreated: '', // WalletAction has no timestamp — populated later from block data if available
			}))
			console.log(`[RPC] getTransactionHistory done: ${entries.length} results`)
			return { entries }
		},

		inscribeFile: async ({
			base64Content,
			contentType,
			map,
		}: InscribeFileParams) => {
			const w = requireWallet()
			const ctx = createContext(w.wallet, {
				services: w.services,
				chain: 'main',
			})
			const result = await inscribe.execute(ctx, {
				base64Content,
				contentType,
				map,
			})
			if (result.error) {
				return { error: result.error }
			}
			return { txid: result.txid }
		},

		getOpnsNames: async () => {
			const w = requireWallet()
			const ctx = createContext(w.wallet, {
				services: w.services,
				chain: 'main',
			})
			const result = await getOpnsNames.execute(ctx, {})
			const names: OpnsNameInfo[] = result.outputs.map((o) => {
				const nameTag = (o.tags ?? []).find((t) => t.startsWith('name:'))
				return {
					outpoint: o.outpoint,
					name: nameTag ? nameTag.slice(5) : '',
					tags: o.tags ?? [],
				}
			})
			return { names }
		},

		pickFile: async ({
			allowedFileTypes,
		}: { allowedFileTypes?: string } = {}) => {
			try {
				const filePaths = await Utils.openFileDialog({
					allowedFileTypes: allowedFileTypes ?? '*',
					canChooseFiles: true,
					canChooseDirectory: false,
					allowsMultipleSelection: false,
				})

				if (!filePaths || filePaths.length === 0 || !filePaths[0]) {
					return { error: 'No file selected' } as { error: string }
				}

				const filePath = filePaths[0]
				const file = Bun.file(filePath)
				const bytes = new Uint8Array(await file.arrayBuffer())

				// Convert to base64 without Buffer
				const base64Content = SdkUtils.toBase64(Array.from(bytes))

				const filename = filePath.split('/').pop() ?? filePath
				const contentType = guessMimeType(filename)

				return {
					base64Content,
					contentType,
					filename,
					sizeBytes: bytes.length,
				} as FileReadResult
			} catch (err) {
				return {
					error: err instanceof Error ? err.message : String(err),
				} as { error: string }
			}
		},

		getLockData: async () => {
			console.log('[RPC] getLockData called')
			const w = requireWallet()
			const ctx = createContext(w.wallet, {
				services: w.services,
				chain: 'main',
			})
			const data = await getLockData.execute(ctx, {} as Record<string, never>)
			console.log('[RPC] getLockData done:', JSON.stringify(data))
			return data as LockDataInfo
		},

		lockBsv: async ({ satoshis, until }: LockBsvParams) => {
			const w = requireWallet()
			const ctx = createContext(w.wallet, {
				services: w.services,
				chain: 'main',
			})
			const result = await lockBsv.execute(ctx, {
				requests: [{ satoshis, until }],
			})
			return { txid: result.txid, error: result.error }
		},

		unlockBsv: async () => {
			const w = requireWallet()
			const ctx = createContext(w.wallet, {
				services: w.services,
				chain: 'main',
			})
			const result = await unlockBsv.execute(ctx, {} as Record<string, never>)
			return { txid: result.txid, error: result.error }
		},

		sendBsv21: async ({ tokenId, amount, address }: SendBsv21Params) => {
			const w = requireWallet()
			const ctx = createContext(w.wallet, {
				services: w.services,
				chain: 'main',
			})
			const result = await sendBsv21.execute(ctx, {
				tokenId,
				amount,
				address,
			})
			return { txid: result.txid, error: result.error }
		},

		sweepScan: async ({ wif }: { wif: string }) => {
			try {
				const pk = PrivateKey.fromWif(wif)
				const address = pk.toPublicKey().toAddress()
				const w = requireWallet()
				if (!w.services) throw new Error('Services required for sweep scan')

				// Collect unspent outputs via the SSE stream
				const funding: SweepScanResult['funding'] = []
				let totalSats = 0
				for await (const event of w.services.owner.getTxos(address, {
					unspent: true,
					limit: 1000,
				})) {
					if (event.type === 'txo') {
						const sats = event.data.satoshis ?? 0
						if (sats > 1) {
							// Fetch the raw tx to get the locking script
							const [txid, voutStr] = event.data.outpoint.split('.')
							const vout = Number.parseInt(voutStr, 10)
							const rawTx = await w.services.beef.getRawTx(txid)
							let lockingScript = ''
							if (rawTx && rawTx.length > 0) {
								const tx = Transaction.fromBinary(Array.from(rawTx))
								lockingScript = tx.outputs[vout]?.lockingScript?.toHex() ?? ''
							}
							funding.push({
								outpoint: event.data.outpoint,
								satoshis: sats,
								lockingScript,
							})
							totalSats += sats
						}
					}
					if (event.type === 'done' || event.type === 'error') break
				}
				return {
					funding,
					ordinals: [],
					tokens: [],
					totalSats,
				} as SweepScanResult
			} catch (err) {
				throw new Error(
					err instanceof Error ? err.message : 'Sweep scan failed',
				)
			}
		},

		sweepBsv: async ({
			wif,
			assets,
		}: { wif: string; assets: SweepScanResult }) => {
			const w = requireWallet()
			const ctx = createContext(w.wallet, {
				services: w.services,
				chain: 'main',
			})
			const inputs = assets.funding.map((f) => ({
				outpoint: f.outpoint,
				satoshis: f.satoshis,
				lockingScript: f.lockingScript,
			}))
			const result = await sweepBsv.execute(ctx, { inputs, wif })
			return { txid: result.txid, error: result.error }
		},

		createSocialPost: async ({ content }: CreateSocialPostParams) => {
			const w = requireWallet()
			const ctx = createContext(w.wallet, {
				services: w.services,
				chain: 'main',
			})
			const result = await createSocialPost.execute(ctx, {
				app: '1sat-desktop',
				content,
			})
			return { txid: result.txid, error: result.error }
		},

		getIdentity: async () => {
			const w = requireWallet()
			const ctx = createContext(w.wallet, {
				services: w.services,
				chain: 'main',
			})
			const bapId = await resolveBapId(ctx)
			let profile: Record<string, unknown> | null = null
			if (bapId) {
				const profileResult = await getProfile.execute(
					ctx,
					{} as Record<string, never>,
				)
				if (profileResult.profile) {
					profile = profileResult.profile
				}
			}
			return { bapId, profile }
		},

		publishIdentity: async () => {
			const w = requireWallet()
			const ctx = createContext(w.wallet, {
				services: w.services,
				chain: 'main',
			})
			const result = await publishIdentity.execute(ctx, {})
			return {
				txid: result.txid,
				bapId: result.bapId,
				error: result.error,
			}
		},

		opnsRegister: async ({ outpoint }: OpnsOperationParams) => {
			const w = requireWallet()
			const ctx = createContext(w.wallet, {
				services: w.services,
				chain: 'main',
			})
			// Find the specific ordinal output by outpoint
			const listResult = await w.wallet.listOutputs({
				basket: OPNS_BASKET,
				includeTags: true,
				includeCustomInstructions: true,
				include: 'entire transactions',
				limit: 1000,
			})
			const ordinal = listResult.outputs.find((o) => o.outpoint === outpoint)
			if (!ordinal) {
				return { error: 'OpNS name not found' }
			}
			const result = await opnsRegister.execute(ctx, {
				ordinal,
				inputBEEF: listResult.BEEF as number[] | undefined,
			})
			return { txid: result.txid, error: result.error }
		},

		opnsDeregister: async ({ outpoint }: OpnsOperationParams) => {
			const w = requireWallet()
			const ctx = createContext(w.wallet, {
				services: w.services,
				chain: 'main',
			})
			const listResult = await w.wallet.listOutputs({
				basket: OPNS_BASKET,
				includeTags: true,
				includeCustomInstructions: true,
				include: 'entire transactions',
				limit: 1000,
			})
			const ordinal = listResult.outputs.find((o) => o.outpoint === outpoint)
			if (!ordinal) {
				return { error: 'OpNS name not found' }
			}
			const result = await opnsDeregister.execute(ctx, {
				ordinal,
				inputBEEF: listResult.BEEF as number[] | undefined,
			})
			return { txid: result.txid, error: result.error }
		},

		mintCollection: async (params: MintCollectionParams) => {
			const w = requireWallet()
			const ctx = createContext(w.wallet, {
				services: w.services,
				chain: 'main',
			})
			const { mintCollection } = await import('@1sat/actions')
			const result = await mintCollection.execute(ctx, params)
			return {
				txid: result.txid,
				collectionId: result.collectionId,
				error: result.error,
			}
		},

		mintCollectionItem: async (params: MintCollectionItemParams) => {
			const w = requireWallet()
			const ctx = createContext(w.wallet, {
				services: w.services,
				chain: 'main',
			})
			const { mintCollectionItem } = await import('@1sat/actions')
			const result = await mintCollectionItem.execute(ctx, params)
			return { txid: result.txid, error: result.error }
		},

		listOrdinal: async ({ outpoint, price }: { outpoint: string; price: number }) => {
			const w = requireWallet()
			const ctx = createContext(w.wallet, { services: w.services, chain: 'main' })
			const { listOrdinal } = await import('@1sat/actions')
			const listResult = await w.wallet.listOutputs({
				basket: 'ordinals',
				includeCustomInstructions: true,
				include: 'entire transactions',
				limit: 1000,
			})
			const ordinal = listResult.outputs.find((o) => o.outpoint === outpoint)
			if (!ordinal) return { error: 'Ordinal not found in wallet' }
			const result = await listOrdinal.execute(ctx, {
				ordinal,
				price,
				inputBEEF: listResult.BEEF as number[] | undefined,
			})
			return { txid: result.txid, error: result.error }
		},

		cancelListing: async ({ outpoint }: { outpoint: string }) => {
			const w = requireWallet()
			const ctx = createContext(w.wallet, { services: w.services, chain: 'main' })
			const { cancelListing } = await import('@1sat/actions')
			const listResult = await w.wallet.listOutputs({
				basket: 'ordinals',
				includeCustomInstructions: true,
				include: 'entire transactions',
				limit: 1000,
			})
			const listing = listResult.outputs.find((o) => o.outpoint === outpoint)
			if (!listing) return { error: 'Listing not found in wallet' }
			const result = await cancelListing.execute(ctx, {
				listing,
				inputBEEF: listResult.BEEF as number[] | undefined,
			})
			return { txid: result.txid, error: result.error }
		},

		purchaseOrdinal: async ({ outpoint }: { outpoint: string }) => {
			const w = requireWallet()
			const ctx = createContext(w.wallet, { services: w.services, chain: 'main' })
			const { purchaseOrdinal } = await import('@1sat/actions')
			const result = await purchaseOrdinal.execute(ctx, { outpoint })
			return { txid: result.txid, error: result.error }
		},

		purchaseBsv21: async ({ tokenId, outpoint, amount }: { tokenId: string; outpoint: string; amount: string }) => {
			const w = requireWallet()
			const ctx = createContext(w.wallet, { services: w.services, chain: 'main' })
			const { purchaseBsv21 } = await import('@1sat/actions')
			const result = await purchaseBsv21.execute(ctx, { tokenId, outpoint, amount })
			return { txid: result.txid, error: result.error }
		},

		getStackStatus: () => {
			return { running: isStackRunning(), url: getStackUrl() }
		},

		getChatMessages: async ({
			channel,
			limit,
		}: { channel: string; limit?: number }) => {
			const messages = await fetchChannelMessages(channel, limit ?? 50)
			return { messages }
		},

		sendChatMessage: async ({
			channel,
			content,
		}: { channel: string; content: string }) => {
			const w = requireWallet()
			const ctx = createContext(w.wallet, {
				services: w.services,
				chain: 'main',
			})
			const result = await createSocialPost.execute(ctx, {
				app: 'bitchatnitro.com',
				content,
				tags: [`channel:${channel}`],
			})
			return { txid: result.txid, error: result.error }
		},

		checkAiProvider: async ({ baseUrl }: { baseUrl?: string }) => {
			const url = baseUrl ?? 'http://localhost:11434'
			try {
				const res = await fetch(`${url}/api/tags`, { signal: AbortSignal.timeout(3000) })
				if (!res.ok) return { available: false, models: [] }
				const data = await res.json()
				const models = (data.models ?? []).map((m: { name: string }) => m.name)
				return { available: true, models }
			} catch {
				return { available: false, models: [] }
			}
		},

		getChatChannels: () => {
			return { channels: getChatChannels() }
		},

		subscribeChatChannel: ({ channel }: { channel: string }) => {
			subscribeChannel(channel)
			return { success: true }
		},

		unsubscribeChatChannel: ({ channel }: { channel: string }) => {
			unsubscribeChannel(channel)
			return { success: true }
		},

		checkForUpdates: () => {
			// Fire-and-forget — status pushes arrive via the updateStatus message
			checkForUpdatesManual()
			return { success: true }
		},

		applyUpdate: async () => {
			await applyUpdate()
			return { success: true }
		},

		getAppVersion: async () => {
			return await getAppVersionInfo()
		},
	}
}
