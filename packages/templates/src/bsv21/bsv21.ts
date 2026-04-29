import {
	type LockingScript,
	type Script,
	type ScriptTemplate,
	type UnlockingScript,
	Utils,
} from '@bsv/sdk'
import type { TokenInscription, TokenOptions } from '../bsv20/bsv20.js'
import Inscription from '../inscription/inscription.js'

/**
 * BSV-21 token operation types
 */
export type BSV21Operation =
	| 'deploy+mint'
	| 'deploy+auth'
	| 'mint'
	| 'auth'
	| 'transfer'
	| 'burn'

/**
 * BSV-21 token data structure for JSON payload.
 *
 * `amt` is required for `deploy+mint`, `mint`, `transfer`, `burn`.
 * `amt` MUST be absent for `deploy+auth` and `auth` (capability-only ops).
 */
export interface BSV21TokenData extends Omit<TokenInscription, 'amt'> {
	/** Token operation */
	op: BSV21Operation
	/** Token symbol (for deploy+mint and deploy+auth only) */
	sym?: string
	/** Decimals (for deploy+mint and deploy+auth only, max 18) */
	dec?: number
	/** Icon URL or data URI (for deploy+mint and deploy+auth only) */
	icon?: string
	/** Token ID (for mint/auth/transfer/burn only) */
	id?: string
	/** Token amount (omitted for deploy+auth and auth) */
	amt?: string
}

/**
 * BSV-21 token inscription interface (compatible with js-1sat-ord)
 */
export interface BSV21Inscription extends Omit<TokenInscription, 'amt'> {
	/** Token operation */
	op: BSV21Operation
	/** Token symbol (for deploy+mint and deploy+auth only) */
	sym?: string
	/** Decimals (for deploy+mint and deploy+auth only, max 18) */
	dec?: number
	/** Icon URL or data URI (for deploy+mint and deploy+auth only) */
	icon?: string
	/** Token ID (for mint/auth/transfer/burn only) */
	id?: string
	/** Token amount (omitted for deploy+auth and auth) */
	amt?: string
}

/**
 * BSV-21 token creation options
 */
export interface BSV21Options extends TokenOptions {}

/**
 * BSV-21 class implementing ScriptTemplate for advanced token functionality.
 *
 * BSV-21 is an advanced token standard that builds on inscriptions to create
 * sophisticated tokens with rich metadata, file attachments, and complex operations.
 * Unlike BSV-20's simple JSON structure, BSV-21 leverages the full power of
 * inscriptions for token data storage.
 *
 * @example
 * ```typescript
 * // Create deploy+mint token (initial token creation)
 * const token = BSV21.deployMint("MYTOKEN", 1000000n, 8, "https://example.com/icon.png");
 * const lockingScript = token.lock();
 *
 * // Transfer tokens
 * const transfer = BSV21.transfer("token_deployment_outpoint", 500n);
 * const transferScript = transfer.lock();
 *
 * // Parse token from script
 * const parsed = BSV21.decode(someScript);
 * if (parsed) {
 *   console.log(`Symbol: ${parsed.getSymbol()}`);
 *   console.log(`Amount: ${parsed.getAmount()}`);
 *   console.log(`Operation: ${parsed.tokenData.op}`);
 * }
 * ```
 */
export default class BSV21 implements ScriptTemplate {
	/** BSV-21 token data */
	public readonly tokenData: BSV21TokenData
	/** Underlying inscription containing the token data */
	public readonly inscription: Inscription

	/**
	 * Creates a new BSV21 instance
	 *
	 * @param tokenData - The token data structure
	 * @param inscription - The inscription containing the token data
	 */
	constructor(tokenData: BSV21TokenData, inscription: Inscription) {
		this.tokenData = tokenData
		this.inscription = inscription
	}

	/**
	 * Creates a deploy+mint token (initial token creation with minting)
	 *
	 * @param symbol - Token symbol/ticker (e.g., "MYTOKEN")
	 * @param amount - Initial amount to mint
	 * @param decimals - Number of decimal places (0-18, default 0)
	 * @param icon - Optional icon URL or data URI
	 * @param options - Optional inscription parameters
	 * @returns A new BSV21 instance
	 */
	static deployMint(
		symbol: string,
		amount: bigint,
		decimals = 0,
		icon?: string,
		options: BSV21Options = {},
	): BSV21 {
		// Validate parameters
		if (symbol == null || symbol === '' || symbol.length === 0) {
			throw new Error('Symbol cannot be empty')
		}
		if (symbol.length > 32) {
			throw new Error('Symbol cannot exceed 32 characters')
		}
		if (amount <= BigInt(0)) {
			throw new Error('Amount must be positive')
		}
		if (decimals < 0 || decimals > 18) {
			throw new Error('Decimals must be between 0 and 18')
		}

		// Create token data
		const tokenData: BSV21TokenData = {
			p: 'bsv-20',
			op: 'deploy+mint',
			sym: symbol,
			amt: amount.toString(),
		}

		// Add optional fields
		if (decimals > 0) {
			tokenData.dec = decimals
		}
		if (icon != null && icon !== '') {
			tokenData.icon = icon
		}

		// Create inscription with token JSON
		// Note: dec must be serialized as a string per BSV-20 protocol
		const wireFormat: Record<string, unknown> = {
			...tokenData,
			dec: tokenData.dec !== undefined ? tokenData.dec.toString() : undefined,
		}
		// Remove undefined fields
		for (const key of Object.keys(wireFormat)) {
			if (wireFormat[key] === undefined) {
				delete wireFormat[key]
			}
		}
		const jsonContent = JSON.stringify(wireFormat)
		const inscription = Inscription.fromText(
			jsonContent,
			'application/bsv-20',
			options,
		)

		return new BSV21(tokenData, inscription)
	}

	/**
	 * Creates a deploy+auth token (mintable token genesis with no initial supply).
	 *
	 * Emits a deploy declaration carrying the token's metadata. The accompanying
	 * `auth` output (built separately via {@link BSV21.auth}) carries the capability
	 * to mint future supply.
	 *
	 * @param symbol - Token symbol/ticker
	 * @param decimals - Number of decimal places (0-18, default 0)
	 * @param icon - Optional icon URL or data URI
	 * @param options - Optional inscription parameters
	 * @returns A new BSV21 instance
	 */
	static deployAuth(
		symbol: string,
		decimals = 0,
		icon?: string,
		options: BSV21Options = {},
	): BSV21 {
		if (symbol == null || symbol === '' || symbol.length === 0) {
			throw new Error('Symbol cannot be empty')
		}
		if (symbol.length > 32) {
			throw new Error('Symbol cannot exceed 32 characters')
		}
		if (decimals < 0 || decimals > 18) {
			throw new Error('Decimals must be between 0 and 18')
		}

		const tokenData: BSV21TokenData = {
			p: 'bsv-20',
			op: 'deploy+auth',
			sym: symbol,
		}

		if (decimals > 0) {
			tokenData.dec = decimals
		}
		if (icon != null && icon !== '') {
			tokenData.icon = icon
		}

		const wireFormat: Record<string, unknown> = {
			p: tokenData.p,
			op: tokenData.op,
			sym: tokenData.sym,
		}
		if (tokenData.dec !== undefined) {
			wireFormat.dec = tokenData.dec.toString()
		}
		if (tokenData.icon !== undefined) {
			wireFormat.icon = tokenData.icon
		}

		const inscription = Inscription.fromText(
			JSON.stringify(wireFormat),
			'application/bsv-20',
			options,
		)

		return new BSV21(tokenData, inscription)
	}

	/**
	 * Creates a mint operation that adds new supply to an existing mintable token.
	 *
	 * The transaction containing this output must spend an existing `auth` UTXO
	 * for the same `tokenId` to prove minting authority.
	 *
	 * @param tokenId - Token deployment outpoint (txid_vout)
	 * @param amount - Amount to mint
	 * @param options - Optional inscription parameters
	 * @returns A new BSV21 instance
	 */
	static mint(
		tokenId: string,
		amount: bigint,
		options: BSV21Options = {},
	): BSV21 {
		if (tokenId == null || tokenId === '' || tokenId.length === 0) {
			throw new Error('Token ID cannot be empty')
		}
		if (amount <= BigInt(0)) {
			throw new Error('Amount must be positive')
		}

		const parts = tokenId.split('_')
		if (
			parts.length !== 2 ||
			parts[0].length !== 64 ||
			!/^\d+$/.test(parts[1])
		) {
			throw new Error('Token ID must be in format: txid_vout')
		}

		const tokenData: BSV21TokenData = {
			p: 'bsv-20',
			op: 'mint',
			id: tokenId,
			amt: amount.toString(),
		}

		const inscription = Inscription.fromText(
			JSON.stringify(tokenData),
			'application/bsv-20',
			options,
		)

		return new BSV21(tokenData, inscription)
	}

	/**
	 * Creates an auth output that propagates the mint capability for a token.
	 *
	 * Auth outputs carry no `amt` — they are pure capability tokens. A mint
	 * transaction must spend an existing auth UTXO and (typically) produce a
	 * new auth output to continue the chain.
	 *
	 * @param tokenId - Token deployment outpoint (txid_vout)
	 * @param options - Optional inscription parameters
	 * @returns A new BSV21 instance
	 */
	static auth(tokenId: string, options: BSV21Options = {}): BSV21 {
		if (tokenId == null || tokenId === '' || tokenId.length === 0) {
			throw new Error('Token ID cannot be empty')
		}

		const parts = tokenId.split('_')
		if (
			parts.length !== 2 ||
			parts[0].length !== 64 ||
			!/^\d+$/.test(parts[1])
		) {
			throw new Error('Token ID must be in format: txid_vout')
		}

		const tokenData: BSV21TokenData = {
			p: 'bsv-20',
			op: 'auth',
			id: tokenId,
		}

		const inscription = Inscription.fromText(
			JSON.stringify(tokenData),
			'application/bsv-20',
			options,
		)

		return new BSV21(tokenData, inscription)
	}

	/**
	 * Creates a transfer token for moving tokens between addresses
	 *
	 * @param tokenId - Token deployment transaction outpoint (txid_vout)
	 * @param amount - Amount to transfer
	 * @param options - Optional inscription parameters
	 * @returns A new BSV21 instance
	 */
	static transfer(
		tokenId: string,
		amount: bigint,
		options: BSV21Options = {},
	): BSV21 {
		// Validate parameters
		if (tokenId == null || tokenId === '' || tokenId.length === 0) {
			throw new Error('Token ID cannot be empty')
		}
		if (amount <= BigInt(0)) {
			throw new Error('Amount must be positive')
		}

		// Validate token ID format (txid_vout)
		const parts = tokenId.split('_')
		if (
			parts.length !== 2 ||
			parts[0].length !== 64 ||
			!/^\d+$/.test(parts[1])
		) {
			throw new Error('Token ID must be in format: txid_vout')
		}

		// Create token data
		const tokenData: BSV21TokenData = {
			p: 'bsv-20',
			op: 'transfer',
			id: tokenId,
			amt: amount.toString(),
		}

		// Create inscription with token JSON
		const jsonContent = JSON.stringify(tokenData)
		const inscription = Inscription.fromText(
			jsonContent,
			'application/bsv-20',
			options,
		)

		return new BSV21(tokenData, inscription)
	}

	/**
	 * Creates a burn token for permanently destroying tokens
	 *
	 * @param tokenId - Token deployment transaction outpoint (txid_vout)
	 * @param amount - Amount to burn
	 * @param options - Optional inscription parameters
	 * @returns A new BSV21 instance
	 */
	static burn(
		tokenId: string,
		amount: bigint,
		options: BSV21Options = {},
	): BSV21 {
		// Validate parameters
		if (tokenId == null || tokenId === '' || tokenId.length === 0) {
			throw new Error('Token ID cannot be empty')
		}
		if (amount <= BigInt(0)) {
			throw new Error('Amount must be positive')
		}

		// Validate token ID format (txid_vout)
		const parts = tokenId.split('_')
		if (
			parts.length !== 2 ||
			parts[0].length !== 64 ||
			!/^\d+$/.test(parts[1])
		) {
			throw new Error('Token ID must be in format: txid_vout')
		}

		// Create token data
		const tokenData: BSV21TokenData = {
			p: 'bsv-20',
			op: 'burn',
			id: tokenId,
			amt: amount.toString(),
		}

		// Create inscription with token JSON
		const jsonContent = JSON.stringify(tokenData)
		const inscription = Inscription.fromText(
			jsonContent,
			'application/bsv-20',
			options,
		)

		return new BSV21(tokenData, inscription)
	}

	/**
	 * Decodes a BSV-21 token from a script
	 *
	 * @param script - The script containing BSV-21 token data
	 * @returns Decoded BSV-21 token or null if not found/invalid
	 */
	static decode(script: Script): BSV21 | null {
		try {
			// First decode as inscription
			const inscription = Inscription.decode(script)
			if (inscription == null) return null

			// Check if it's BSV-21 token (application/bsv-20 MIME type)
			if (inscription.file.type !== 'application/bsv-20') return null

			// Parse JSON content - use raw content since application/bsv-20 is not recognized as text
			let jsonText: string
			try {
				jsonText = Utils.toUTF8(Array.from(inscription.file.content))
			} catch {
				return null
			}

			const data = JSON.parse(jsonText)

			// Validate required protocol fields
			if (data.p !== 'bsv-20') return null
			if (data.op == null || typeof data.op !== 'string') return null

			const operation = data.op.toLowerCase() as BSV21Operation

			// Auth ops MUST NOT carry amt; all other ops require amt
			const isAuthOp = operation === 'deploy+auth' || operation === 'auth'
			if (isAuthOp) {
				if (data.amt !== undefined) return null
			} else {
				if (data.amt == null || typeof data.amt !== 'string') return null
				try {
					const amount = BigInt(data.amt)
					if (amount <= BigInt(0)) return null
				} catch {
					return null
				}
			}

			// Validate operation and required fields
			switch (operation) {
				case 'deploy+mint':
				case 'deploy+auth':
					if (data.sym == null || typeof data.sym !== 'string') return null
					if (data.sym.length === 0 || data.sym.length > 32) return null
					if (data.dec !== undefined) {
						// dec must be a string in the JSON - reject if it's a JS number
						if (typeof data.dec !== 'string') return null
						const dec = Number.parseInt(data.dec, 10)
						if (Number.isNaN(dec)) return null
						if (dec < 0 || dec > 18) return null
						// Normalize to number for tokenData
						data.dec = dec
					}
					break

				case 'mint':
				case 'auth':
				case 'transfer':
				case 'burn': {
					if (data.id == null || typeof data.id !== 'string') return null
					// Validate token ID format
					const parts = data.id.split('_')
					if (
						parts.length !== 2 ||
						parts[0].length !== 64 ||
						!/^\d+$/.test(parts[1])
					) {
						return null
					}
					break
				}

				default:
					return null
			}

			// Create token data structure
			const tokenData: BSV21TokenData = {
				p: 'bsv-20',
				op: operation,
			}
			if (!isAuthOp) {
				tokenData.amt = data.amt
			}

			// Add operation-specific fields
			if (operation === 'deploy+mint' || operation === 'deploy+auth') {
				tokenData.sym = data.sym
				if (data.dec !== undefined) {
					tokenData.dec = data.dec
				}
				if (data.icon != null && data.icon !== '') {
					tokenData.icon = data.icon
				}
			} else {
				tokenData.id = data.id
			}

			return new BSV21(tokenData, inscription)
		} catch {
			return null
		}
	}

	/**
	 * Creates a locking script containing the BSV-21 token inscription
	 *
	 * @param lockingScript - Optional locking script to append as suffix
	 * @returns A locking script containing the token data
	 */
	lock(lockingScript?: LockingScript): LockingScript {
		if (lockingScript != null) {
			const options: BSV21Options = {
				parent: this.inscription.parent,
				scriptPrefix: this.inscription.scriptPrefix,
				scriptSuffix: lockingScript,
			}

			// Build wire format: `dec` must be serialized as a string per BSV-20
			// protocol; strip any undefined fields.
			const wireFormat: Record<string, unknown> = { ...this.tokenData }
			if (this.tokenData.dec !== undefined) {
				wireFormat.dec = this.tokenData.dec.toString()
			}
			for (const key of Object.keys(wireFormat)) {
				if (wireFormat[key] === undefined) {
					delete wireFormat[key]
				}
			}

			const newInscription = Inscription.fromText(
				JSON.stringify(wireFormat),
				'application/bsv-20',
				options,
			)
			return newInscription.lock()
		}

		return this.inscription.lock()
	}

	/**
	 * BSV-21 tokens cannot be unlocked directly as they are data containers
	 *
	 * @throws Error indicating unlock is not supported
	 */
	unlock(): {
		sign: () => Promise<UnlockingScript>
		estimateLength: () => Promise<number>
	} {
		throw new Error('BSV-21 tokens cannot be unlocked directly')
	}

	/**
	 * Gets the token amount as BigInt. Auth ops (`deploy+auth`, `auth`) carry no
	 * amount and return 0n.
	 *
	 * @returns Token amount, or 0n for auth ops
	 */
	getAmount(): bigint {
		return this.tokenData.amt != null ? BigInt(this.tokenData.amt) : 0n
	}

	/**
	 * Gets the token amount as BigInt (concise method)
	 *
	 * @returns Token amount
	 */
	amount(): bigint {
		return this.getAmount()
	}

	/**
	 * Gets the token symbol (for deploy+mint operations)
	 *
	 * @returns Token symbol or undefined for transfer/burn operations
	 */
	getSymbol(): string | undefined {
		return this.tokenData.sym
	}

	/**
	 * Gets the token symbol (concise method)
	 *
	 * @returns Token symbol or undefined for transfer/burn operations
	 */
	symbol(): string | undefined {
		return this.getSymbol()
	}

	/**
	 * Gets the number of decimal places (for deploy+mint operations)
	 *
	 * @returns Number of decimals, defaults to 0
	 */
	getDecimals(): number {
		return this.tokenData.dec ?? 0
	}

	/**
	 * Gets the token ID (for transfer/burn operations)
	 *
	 * @returns Token deployment outpoint or undefined for deploy+mint operations
	 */
	getTokenId(): string | undefined {
		return this.tokenData.id
	}

	/**
	 * Gets the icon URL or data URI (for deploy+mint operations)
	 *
	 * @returns Icon string or undefined
	 */
	getIcon(): string | undefined {
		return this.tokenData.icon
	}

	/**
	 * Checks if this token has an icon
	 *
	 * @returns true if icon is present
	 */
	hasIcon(): boolean {
		return this.tokenData.icon != null && this.tokenData.icon !== ''
	}

	/**
	 * Gets the token operation type
	 *
	 * @returns The operation (deploy+mint, transfer, or burn)
	 */
	getOperation(): BSV21Operation {
		return this.tokenData.op
	}

	/**
	 * Gets the token operation type (concise method)
	 *
	 * @returns The operation (deploy+mint, transfer, or burn)
	 */
	operation(): BSV21Operation {
		return this.getOperation()
	}

	/**
	 * Checks if this is a deploy+mint operation
	 *
	 * @returns true for deploy+mint operations
	 */
	isDeployMint(): boolean {
		return this.tokenData.op === 'deploy+mint'
	}

	/**
	 * Checks if this is a transfer operation
	 *
	 * @returns true for transfer operations
	 */
	isTransfer(): boolean {
		return this.tokenData.op === 'transfer'
	}

	/**
	 * Checks if this is a burn operation
	 *
	 * @returns true for burn operations
	 */
	isBurn(): boolean {
		return this.tokenData.op === 'burn'
	}

	/**
	 * Gets the underlying inscription
	 *
	 * @returns The inscription containing the token data
	 */
	getInscription(): Inscription {
		return this.inscription
	}

	/**
	 * Gets the token data as formatted JSON string
	 *
	 * @returns JSON representation of token data
	 */
	toJSON(): string {
		return JSON.stringify(this.tokenData, null, 2)
	}
}
