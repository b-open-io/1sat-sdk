/**
 * RPC request handlers — Bun side.
 *
 * Each handler matches a key in `BunRequests` (the `webview.requests`
 * section of the RPC schema). The WebView calls these via
 * `electroview.rpc.request.<name>(params)`.
 */
import { createContext, sendBsv } from "@1sat/actions"
import { generateMnemonic, isValidMnemonic } from "@1sat/utils"
import { BRC29_PROTOCOL_ID } from "@1sat/types"
import { PublicKey, Utils as SdkUtils } from "@bsv/sdk"
import {
	create,
	getStatus,
	getWallet,
	lock,
	unlock,
} from "./wallet-manager"

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
 * Each function signature matches the RPC schema params → response contract.
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
		}: { mnemonic: string; passphrase: string }) => {
			try {
				await create(mnemonic, passphrase)
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
		}: { mnemonic: string; passphrase: string }) => {
			try {
				if (!isValidMnemonic(mnemonic)) {
					return { success: false, error: "Invalid mnemonic phrase" }
				}
				await create(mnemonic, passphrase)
				return { success: true }
			} catch (err) {
				return {
					success: false,
					error: err instanceof Error ? err.message : String(err),
				}
			}
		},

		unlockWallet: async ({ passphrase }: { passphrase: string }) => {
			try {
				await unlock(passphrase)
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

		getBalance: async () => {
			const { wallet } = requireWallet()
			const result = await wallet.listOutputs({
				basket: "default",
				include: "locking scripts",
			})
			let confirmed = 0
			let unconfirmed = 0
			for (const output of result.outputs) {
				if (output.spendable) {
					// Outputs with a blockHeight are confirmed
					if (output.outputDescription) {
						confirmed += output.satoshis
					} else {
						unconfirmed += output.satoshis
					}
				}
			}
			return { confirmed, unconfirmed }
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
	}
}
