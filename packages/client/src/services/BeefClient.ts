import type { ClientOptions } from '@1sat/types'
import { BaseClient } from './BaseClient.js'

/**
 * Client for /1sat/beef/* routes.
 * Provides BEEF data, raw transactions, and merkle proofs.
 *
 * Routes:
 * - GET /:txid - Get BEEF for transaction
 * - GET /:txid/raw - Get raw transaction bytes
 * - GET /:txid/proof - Get merkle proof
 */
export class BeefClient extends BaseClient {
	constructor(baseUrl: string, options: ClientOptions = {}) {
		super(`${baseUrl}/1sat/beef`, options)
	}

	/**
	 * Get BEEF (Background Evaluation Extended Format) for a transaction
	 */
	async getBeef(txid: string): Promise<Uint8Array> {
		return this.requestBinary(`/${txid}`)
	}

	/**
	 * Get raw transaction bytes
	 */
	async getRawTx(txid: string): Promise<Uint8Array> {
		return this.requestBinary(`/${txid}/tx`)
	}

	/**
	 * Get merkle proof bytes for a mined transaction
	 */
	async getProof(txid: string): Promise<Uint8Array> {
		return this.requestBinary(`/${txid}/proof`)
	}
}
