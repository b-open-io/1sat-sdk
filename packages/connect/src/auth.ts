/**
 * BRC-77 request signing using WalletInterface directly.
 *
 * Same logic as getAuthToken action but without OneSatContext —
 * takes a WalletInterface so any connected wallet can sign.
 */

import { BSM, BigNumber, Hash, PublicKey, Signature, Utils } from '@bsv/sdk'
import type { WalletInterface } from '@bsv/sdk'

const { toArray, toHex } = Utils

const AUTH_PROTOCOL_ID: [0 | 1 | 2, string] = [2, 'bitcoinauth']
const AUTH_KEY_ID = 'auth-0'

function compactSign(
	derSig: number[],
	msgHash: number[],
	pubKeyHex: string,
): string {
	const sig = Signature.fromDER(toHex(derSig), 'hex')
	const pubKey = PublicKey.fromString(pubKeyHex)
	const recovery = sig.CalculateRecoveryFactor(pubKey, new BigNumber(msgHash))
	return sig.toCompact(recovery, true, 'base64') as string
}

/**
 * Sign an HTTP request with BRC-77 auth, returning the auth token string.
 *
 * The token format is: `pubkey|scheme|timestamp|requestPath|signature`
 *
 * @param wallet - Any BRC-100 WalletInterface (Sigma CWI, OneSat, extension, etc.)
 * @param requestPath - API endpoint path including query params
 * @param body - Optional request body to include in signature
 * @param scheme - Signature scheme: 'brc77' (default) or 'bsm'
 */
export async function signRequest(
	wallet: WalletInterface,
	requestPath: string,
	body?: string,
	scheme: 'brc77' | 'bsm' = 'brc77',
): Promise<string> {
	const timestamp = new Date().toISOString()

	const bodyHash = body ? toHex(Hash.sha256(toArray(body, 'utf8'))) : ''

	const message = `${requestPath}|${timestamp}|${bodyHash}`
	const messageBytes = toArray(message, 'utf8')

	const msgHash =
		scheme === 'bsm' ? BSM.magicHash(messageBytes) : Hash.sha256(messageBytes)

	const { publicKey: pubKeyHex } = await wallet.getPublicKey({
		protocolID: AUTH_PROTOCOL_ID,
		keyID: AUTH_KEY_ID,
		forSelf: true,
	})

	const { signature: derSig } = await wallet.createSignature({
		protocolID: AUTH_PROTOCOL_ID,
		keyID: AUTH_KEY_ID,
		counterparty: 'self',
		hashToDirectlySign: Array.from(msgHash),
	})

	const signature = compactSign(derSig, msgHash, pubKeyHex)
	return `${pubKeyHex}|${scheme}|${timestamp}|${requestPath}|${signature}`
}
