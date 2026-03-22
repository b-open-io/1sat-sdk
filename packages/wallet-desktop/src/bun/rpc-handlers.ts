/**
 * RPC request handlers — Bun side.
 *
 * Each handler matches a key in `BunRequests` (the `webview.requests`
 * section of the RPC schema). The WebView calls these via
 * `electroview.rpc.request.<name>(params)`.
 */
import {
	createContext,
	getBsv21Balances,
	getOpnsNames,
	getOrdinals,
	inscribe,
	sendBsv,
} from "@1sat/actions"
import { generateMnemonic, isValidMnemonic } from "@1sat/utils"
import { BRC29_PROTOCOL_ID } from "@1sat/types"
import { PublicKey, Utils as SdkUtils } from "@bsv/sdk"
import { Utils } from "electrobun/bun"
import type {
	FileReadResult,
	HistoryEntry,
	InscribeFileParams,
	OrdinalInfo,
	OpnsNameInfo,
	TokenBalance,
} from "../shared/types"
import {
	create,
	deleteWallet,
	getStatus,
	getWallet,
	lock,
	unlock,
} from "./wallet-manager"

// ============================================================================
// MIME type lookup
// ============================================================================

const MIME_MAP: Record<string, string> = {
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".gif": "image/gif",
	".webp": "image/webp",
	".svg": "image/svg+xml",
	".mp3": "audio/mpeg",
	".mp4": "video/mp4",
	".webm": "video/webm",
	".json": "application/json",
	".txt": "text/plain",
	".html": "text/html",
	".css": "text/css",
	".js": "application/javascript",
	".pdf": "application/pdf",
}

function guessMimeType(filename: string): string {
	const ext = filename.slice(filename.lastIndexOf(".")).toLowerCase()
	return MIME_MAP[ext] ?? "application/octet-stream"
}

// ============================================================================
// Helpers
// ============================================================================

function requireWallet() {
	const w = getWallet()
	if (!w) {
		throw new Error("Wallet is not unlocked")
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
				await create(mnemonic, passphrase ?? "")
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
					return { success: false, error: "Invalid mnemonic phrase" }
				}
				await create(mnemonic, passphrase ?? "")
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
				await unlock(passphrase ?? "")
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
				basket: "default",
				include: "locking scripts",
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
				Array.from(new TextEncoder().encode("1sat")),
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
				chain: "main",
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
				chain: "main",
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
			const w = requireWallet()
			const ctx = createContext(w.wallet, {
				services: w.services,
				chain: "main",
			})
			const balances = await getBsv21Balances.execute(ctx, {})
			const mapped: TokenBalance[] = balances.map((b) => ({
				id: b.id,
				sym: b.sym,
				icon: b.icon,
				dec: b.dec,
				amt: b.amt,
			}))
			return { balances: mapped }
		},

		getTransactionHistory: async ({
			limit,
			offset,
		}: { limit?: number; offset?: number } = {}) => {
			const { wallet } = requireWallet()
			const result = await wallet.listActions({
				labels: [],
				limit: limit ?? 50,
				offset: offset ?? 0,
				includeLabels: true,
			})
			const entries: HistoryEntry[] = (result.actions ?? []).map((a) => ({
				txid: a.txid ?? "",
				description: a.description ?? "",
				satoshis: a.satoshis ?? 0,
				status: a.status ?? "unknown",
				dateCreated: a.isOutgoing ? `sent ${a.description}` : a.description ?? "",
			}))
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
				chain: "main",
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
				chain: "main",
			})
			const result = await getOpnsNames.execute(ctx, {})
			const names: OpnsNameInfo[] = result.outputs.map((o) => {
				const nameTag = (o.tags ?? []).find((t) => t.startsWith("name:"))
				return {
					outpoint: o.outpoint,
					name: nameTag ? nameTag.slice(5) : "",
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
					allowedFileTypes: allowedFileTypes ?? "*",
					canChooseFiles: true,
					canChooseDirectory: false,
					allowsMultipleSelection: false,
				})

				if (!filePaths || filePaths.length === 0 || !filePaths[0]) {
					return { error: "No file selected" } as { error: string }
				}

				const filePath = filePaths[0]
				const file = Bun.file(filePath)
				const bytes = new Uint8Array(await file.arrayBuffer())

				// Convert to base64 without Buffer
				const base64Content = SdkUtils.toBase64(Array.from(bytes))

				const filename = filePath.split("/").pop() ?? filePath
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
	}
}
