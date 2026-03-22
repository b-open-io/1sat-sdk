/**
 * BRC-100 HTTP server for dApp connectivity.
 *
 * Exposes all 28 WalletInterface methods as POST endpoints on 127.0.0.1:3321.
 * Compatible with `new WalletClient('auto')` from `@bsv/sdk`.
 */
import type { Server } from "bun"
import type { WalletInterface } from "@bsv/sdk"
import { getWallet } from "./wallet-manager"

const PORT = 3321
const HOST = "127.0.0.1"

const CORS_HEADERS: Record<string, string> = {
	"Access-Control-Allow-Origin": "*",
	"Access-Control-Allow-Methods": "*",
	"Access-Control-Allow-Headers": "*",
	"Access-Control-Allow-Private-Network": "true",
}

const MANIFEST = {
	name: "1Sat Wallet",
	version: "0.0.1",
	description: "1Sat Wallet Desktop",
}

/** All 28 BRC-100 WalletInterface method names. */
const WALLET_METHODS = [
	"createAction",
	"signAction",
	"abortAction",
	"listActions",
	"internalizeAction",
	"listOutputs",
	"relinquishOutput",
	"getPublicKey",
	"revealCounterpartyKeyLinkage",
	"revealSpecificKeyLinkage",
	"encrypt",
	"decrypt",
	"createHmac",
	"verifyHmac",
	"createSignature",
	"verifySignature",
	"acquireCertificate",
	"listCertificates",
	"proveCertificate",
	"relinquishCertificate",
	"discoverByIdentityKey",
	"discoverByAttributes",
	"isAuthenticated",
	"waitForAuthentication",
	"getHeight",
	"getHeaderForHeight",
	"getNetwork",
	"getVersion",
] as const

type WalletMethod = (typeof WALLET_METHODS)[number]

/** Methods that take no meaningful args — pass `{}` as the first argument. */
const NO_ARG_METHODS = new Set<WalletMethod>([
	"isAuthenticated",
	"waitForAuthentication",
	"getHeight",
	"getNetwork",
	"getVersion",
])

const walletMethodSet = new Set<string>(WALLET_METHODS)

function jsonResponse(
	body: unknown,
	status = 200,
): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
	})
}

function parseOrigin(req: Request): string {
	const origin = req.headers.get("Origin")
	if (origin) {
		try {
			return new URL(origin).host
		} catch {
			return origin
		}
	}
	const originator = req.headers.get("Originator")
	if (originator) {
		try {
			const candidate = originator.includes("://")
				? originator
				: `http://${originator}`
			return new URL(candidate).host
		} catch {
			return originator
		}
	}
	return "unknown"
}

let server: Server | undefined

export function startWalletServer(): void {
	if (server) return

	server = Bun.serve({
		hostname: HOST,
		port: PORT,
		async fetch(req) {
			// Handle CORS preflight
			if (req.method === "OPTIONS") {
				return new Response(null, { status: 204, headers: CORS_HEADERS })
			}

			const url = new URL(req.url)
			const pathname = url.pathname

			// GET /manifest.json
			if (req.method === "GET" && pathname === "/manifest.json") {
				return jsonResponse(MANIFEST)
			}

			// POST /<walletMethod>
			if (req.method === "POST") {
				const method = pathname.slice(1) // strip leading /

				if (!walletMethodSet.has(method)) {
					return jsonResponse({ error: `Unknown endpoint: ${pathname}` }, 404)
				}

				const wallet: WalletInterface | undefined = getWallet()?.wallet
				if (!wallet) {
					return jsonResponse({ error: "Wallet is locked" }, 503)
				}

				const origin = parseOrigin(req)
				const methodName = method as WalletMethod

				try {
					const args = NO_ARG_METHODS.has(methodName)
						? {}
						: await req.json()

					const fn = wallet[methodName] as (
						args: unknown,
						originator: string,
					) => Promise<unknown>
					const result = await fn.call(wallet, args, origin)
					return jsonResponse(result)
				} catch (err) {
					const message =
						err instanceof Error ? err.message : String(err)
					console.error(`[BRC-100] ${methodName} error:`, err)
					return jsonResponse({ error: message }, 400)
				}
			}

			return jsonResponse({ error: `Not found: ${pathname}` }, 404)
		},
	})

	console.log(`BRC-100 wallet server listening on http://${HOST}:${PORT}`)
}

export function stopWalletServer(): void {
	if (server) {
		server.stop()
		server = undefined
		console.log("BRC-100 wallet server stopped")
	}
}
