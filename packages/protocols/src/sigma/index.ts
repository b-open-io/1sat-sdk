/**
 * Sigma protocol signing for 1Sat Ordinals
 *
 * Wraps the sigma-protocol library to sign transaction data
 */

import type {
	AuthToken,
	AuthTransport,
	LocalSigner,
	RemoteSigner,
	Signer,
} from '@1sat/types'
import type { Transaction } from '@bsv/sdk'
import { Sigma, type AuthToken as SigmaAuthToken } from 'sigma-protocol'

/**
 * Type guard to check if signer is a LocalSigner
 */
export function isLocalSigner(signer: Signer): signer is LocalSigner {
	return 'idKey' in signer
}

/**
 * Type guard to check if signer is a RemoteSigner
 */
export function isRemoteSigner(signer: Signer): signer is RemoteSigner {
	return 'keyHost' in signer
}

/**
 * Serialize an AuthToken to the bitcoin-auth string format
 */
export function serializeAuthToken(token: AuthToken): string {
	return `${token.pubkey}|${token.scheme}|${token.timestamp}|${token.requestPath}|${token.signature}`
}

/**
 * Convert our AuthToken + transport to sigma-protocol's AuthToken format
 */
export function toSigmaAuthToken(
	auth: AuthToken,
	transport?: AuthTransport,
): SigmaAuthToken | undefined {
	if (!transport) return undefined

	return {
		type: transport.type,
		key: transport.key,
		value: serializeAuthToken(auth),
	}
}

/**
 * Signs data in the transaction with Sigma protocol
 * @param tx - Transaction to sign
 * @param signer - Local or remote signer (used for data signature)
 * @returns Transaction with signed data
 */
export async function signData(
	tx: Transaction,
	signer: Signer,
): Promise<Transaction> {
	if (isLocalSigner(signer)) {
		const sigma = new Sigma(tx)
		const { signedTx } = sigma.sign(signer.idKey)
		return signedTx
	}

	if (isRemoteSigner(signer)) {
		const sigma = new Sigma(tx)
		// Convert our AuthToken to sigma's format
		const sigmaAuth = signer.authToken
			? toSigmaAuthToken(signer.authToken, signer.transport)
			: undefined
		const { signedTx } = await sigma.remoteSign(signer.keyHost, sigmaAuth)
		return signedTx
	}

	throw new Error('Signer must be a LocalSigner or RemoteSigner')
}

/**
 * Create a Sigma instance for a transaction
 * Useful for manual signing operations
 */
export function createSigma(tx: Transaction): Sigma {
	return new Sigma(tx)
}

// Re-export Sigma class for advanced usage
export { Sigma }
