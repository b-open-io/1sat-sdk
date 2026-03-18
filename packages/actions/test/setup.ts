import { type OneSatContext, createContext } from '@1sat/actions'
import {
	BRC29_PROTOCOL_ID,
	type OneSatServices,
	createRemoteWallet,
} from '@1sat/wallet-remote'
import { PublicKey, Utils } from '@bsv/sdk'
import type { Wallet } from '@bsv/wallet-toolbox/out/src/index.client.js'

const DEFAULT_REMOTE_STORAGE_URL = 'http://localhost:8080/1sat/wallet'
const TEST_ADDRESS_PREFIX = 'test'

export interface TestContext {
	ctx: OneSatContext
	wallet: Wallet
	services: OneSatServices
	destroy: () => Promise<void>
}

function wifEnvKey(label: string): string {
	const upper = label.toUpperCase()
	return (
		process.env[`TEST_WALLET_WIF_${upper}`] ?? process.env.TEST_WALLET_WIF ?? ''
	)
}

function toBase64Prefix(prefix: string): string {
	const encoded = new TextEncoder().encode(prefix)
	return Utils.toBase64(Array.from(encoded))
}

function toBase64Suffix(index: number): string {
	const bytes = [
		(index >>> 24) & 0xff,
		(index >>> 16) & 0xff,
		(index >>> 8) & 0xff,
		index & 0xff,
	]
	return Utils.toBase64(bytes)
}

export async function deriveDepositAddress(wallet: Wallet): Promise<string> {
	const keyID = `${toBase64Prefix(TEST_ADDRESS_PREFIX)} ${toBase64Suffix(0)}`
	const result = await wallet.getPublicKey({
		protocolID: BRC29_PROTOCOL_ID,
		keyID,
		forSelf: true,
	})
	return PublicKey.fromString(result.publicKey).toAddress().toString()
}

export async function createTestContext(label: string): Promise<TestContext> {
	const wif = wifEnvKey(label)
	if (!wif) {
		throw new Error(
			`Missing WIF for label "${label}". Set TEST_WALLET_WIF_${label.toUpperCase()} or TEST_WALLET_WIF in the environment.`,
		)
	}

	const chain = (process.env.TEST_CHAIN ?? 'main') as 'main' | 'test'
	const remoteStorageUrl =
		process.env.TEST_REMOTE_STORAGE_URL ?? DEFAULT_REMOTE_STORAGE_URL

	const result = await createRemoteWallet({
		privateKey: wif,
		chain,
		remoteStorageUrl,
	})

	const ctx = createContext(result.wallet, { services: result.services, chain })

	return {
		ctx,
		wallet: result.wallet,
		services: result.services,
		destroy: result.destroy,
	}
}

/**
 * Sync funding outputs from the owner index into the BRC-100 wallet.
 * Fetches outputs for the wallet's BRC-29 deposit address, then
 * internalizes each as a wallet payment so the wallet can spend them.
 */
export async function syncFunding(context: TestContext): Promise<number> {
	const { wallet } = context
	const address = await deriveDepositAddress(wallet)
	const derivationPrefix = toBase64Prefix(TEST_ADDRESS_PREFIX)
	const derivationSuffix = toBase64Suffix(0)
	const _keyID = `${derivationPrefix} ${derivationSuffix}`

	const senderIdentityKey = (
		await wallet.getPublicKey({
			identityKey: true,
		})
	).publicKey

	const baseUrl =
		process.env.TEST_REMOTE_STORAGE_URL?.replace('/wallet', '') ??
		'http://localhost:8080/1sat'

	// Fetch indexed outputs via owner sync SSE
	const response = await fetch(
		`${baseUrl}/owner/${address}/txos?refresh=true&unspent=true&limit=100`,
	)
	const text = await response.text()

	// Parse SSE txo events into outpoints grouped by txid
	const outpointsByTxid = new Map<string, number[]>()
	for (const line of text.split('\n')) {
		if (!line.startsWith('data: ')) continue
		try {
			const data = JSON.parse(line.slice(6))
			if (!data.outpoint) continue
			const [txid, voutStr] = data.outpoint.split('.')
			const vouts = outpointsByTxid.get(txid) ?? []
			vouts.push(Number(voutStr))
			outpointsByTxid.set(txid, vouts)
		} catch {
			/* skip non-JSON lines */
		}
	}

	let internalized = 0
	for (const [txid, vouts] of outpointsByTxid) {
		// Fetch BEEF from server
		const beefResponse = await fetch(`${baseUrl}/beef/${txid}`)
		if (!beefResponse.ok) continue
		const beefBytes = new Uint8Array(await beefResponse.arrayBuffer())

		await wallet.internalizeAction({
			tx: Array.from(beefBytes),
			outputs: vouts.map((vout) => ({
				outputIndex: vout,
				protocol: 'wallet payment' as const,
				paymentRemittance: {
					derivationPrefix,
					derivationSuffix,
					senderIdentityKey,
				},
			})),
			description: `Sync funding from ${address}`,
		})
		internalized += vouts.length
	}

	return internalized
}

export async function destroyTestContext(context: TestContext): Promise<void> {
	try {
		await context.destroy()
	} catch {
		// Remote storage cleanup may fail — not critical for tests
	}
}
