import {
	type LockingScript,
	type Script,
	type ScriptTemplate,
	type UnlockingScript,
	Utils,
} from '@bsv/sdk'
import Inscription from '../inscription/inscription.js'

/**
 * BSV-20 token operation types
 */
export type BSV20Operation = 'deploy' | 'mint' | 'transfer' | 'burn'

/**
 * Token data structure for JSON payload
 */
export interface TokenData {
	/** Protocol identifier (always "bsv-20") */
	p: 'bsv-20'
	/** Token operation */
	op: string
	/** Amount as string to handle large numbers */
	amt: string
}

/**
 * BSV-20 token data structure for JSON payload
 */
export interface BSV20TokenData extends TokenData {
	/** Token operation */
	op: BSV20Operation
	/** Token ticker/symbol (for deploy, mint, transfer, burn) */
	tick?: string
	/** Decimals (for deploy only, max 18) */
	dec?: number
	/** Maximum supply (for deploy only) */
	max?: string
	/** Limit per mint operation (for deploy only) */
	lim?: string
	/** Token deployment ID (for transfer/burn operations) */
	id?: string
}

/**
 * Token creation options
 */
export interface TokenOptions {
	/** Optional parent inscription reference (36-byte outpoint) */
	parent?: Uint8Array
	/** Optional script prefix to prepend before inscription (e.g., P2PKH locking script) */
	scriptPrefix?: Script | LockingScript
	/** Optional script suffix to append after inscription (e.g., OP_RETURN data) */
	scriptSuffix?: Script | LockingScript
}

/**
 * Token inscription base interface (compatible with js-1sat-ord)
 */
export interface TokenInscription {
	/** Protocol identifier (always "bsv-20") */
	p: 'bsv-20'
	/** Token operation */
	op: string
	/** Amount as string to handle large numbers */
	amt: string
}

/**
 * BSV-20 token inscription interface (compatible with js-1sat-ord)
 */
export interface BSV20Inscription extends TokenInscription {
	/** Token operation */
	op: 'deploy' | 'mint' | 'transfer' | 'burn'
	/** Token ticker/symbol (for deploy, mint, transfer, burn) */
	tick: string
	/** Decimals (for deploy only, max 18) */
	dec?: number
	/** Maximum supply (for deploy only) */
	max?: string
	/** Limit per mint operation (for deploy only) */
	lim?: string
}

/**
 * BSV-20 token creation options
 */
export interface BSV20Options extends TokenOptions {}

/**
 * BSV-20 class implementing ScriptTemplate for basic fungible tokens.
 *
 * BSV-20 is the foundational token standard for BSV blockchain, providing
 * simple and efficient fungible tokens with ticker-based identification.
 * It serves as the base layer for the token economy on BSV.
 *
 * @example
 * ```typescript
 * // Deploy a new token
 * const deploy = BSV20.deploy("MYTOKEN", BigInt("21000000"), 8, BigInt("1000000"));
 * const deployScript = deploy.lock();
 *
 * // Mint tokens
 * const mint = BSV20.mint("MYTOKEN", BigInt("1000000"));
 * const mintScript = mint.lock();
 *
 * // Transfer tokens
 * const transfer = BSV20.transfer("MYTOKEN", BigInt("500"));
 * const transferScript = transfer.lock();
 *
 * // Parse token from script
 * const parsed = BSV20.decode(someScript);
 * if (parsed) {
 *   console.log(`Ticker: ${parsed.getTicker()}`);
 *   console.log(`Amount: ${parsed.getAmount()}`);
 *   console.log(`Operation: ${parsed.tokenData.op}`);
 * }
 * ```
 */
export default class BSV20 implements ScriptTemplate {
	/** BSV-20 token data */
	public readonly tokenData: BSV20TokenData
	/** Underlying inscription containing the token data */
	public readonly inscription: Inscription

	/**
	 * Creates a new BSV20 instance
	 *
	 * @param tokenData - The token data structure
	 * @param inscription - The inscription containing the token data
	 */
	constructor(tokenData: BSV20TokenData, inscription: Inscription) {
		this.tokenData = tokenData
		this.inscription = inscription
	}

	/**
	 * Creates a deploy operation for a new BSV-20 token
	 *
	 * @param ticker - Token ticker/symbol (1-32 characters)
	 * @param maxSupply - Maximum total supply
	 * @param decimals - Number of decimal places (0-18, default 0)
	 * @param limitPerMint - Optional limit per mint operation
	 * @param options - Optional inscription parameters
	 * @returns A new BSV20 instance
	 */
	static deploy(
		ticker: string,
		maxSupply: bigint,
		decimals = 0,
		limitPerMint?: bigint,
		options: BSV20Options = {},
	): BSV20 {
		// Validate parameters
		if (ticker == null || ticker === '' || ticker.length === 0) {
			throw new Error('Ticker cannot be empty')
		}
		if (ticker.length > 32) {
			throw new Error('Ticker cannot exceed 32 characters')
		}
		if (maxSupply <= BigInt(0)) {
			throw new Error('Max supply must be positive')
		}
		if (decimals < 0 || decimals > 18) {
			throw new Error('Decimals must be between 0 and 18')
		}
		if (limitPerMint != null && limitPerMint <= BigInt(0)) {
			throw new Error('Limit per mint must be positive')
		}

		// Create token data
		const tokenData: BSV20TokenData = {
			p: 'bsv-20',
			op: 'deploy',
			tick: ticker,
			amt: '0', // Deploy operation has no amount
			max: maxSupply.toString(),
		}

		// Add optional fields
		if (decimals > 0) {
			tokenData.dec = decimals
		}
		if (limitPerMint != null) {
			tokenData.lim = limitPerMint.toString()
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

		return new BSV20(tokenData, inscription)
	}

	/**
	 * Creates a mint operation for an existing BSV-20 token
	 *
	 * @param ticker - Token ticker to mint
	 * @param amount - Amount to mint
	 * @param options - Optional inscription parameters
	 * @returns A new BSV20 instance
	 */
	static mint(
		ticker: string,
		amount: bigint,
		options: BSV20Options = {},
	): BSV20 {
		// Validate parameters
		if (ticker == null || ticker === '' || ticker.length === 0) {
			throw new Error('Ticker cannot be empty')
		}
		if (ticker.length > 32) {
			throw new Error('Ticker cannot exceed 32 characters')
		}
		if (amount <= BigInt(0)) {
			throw new Error('Amount must be positive')
		}

		// Create token data
		const tokenData: BSV20TokenData = {
			p: 'bsv-20',
			op: 'mint',
			tick: ticker,
			amt: amount.toString(),
		}

		// Create inscription with token JSON
		const jsonContent = JSON.stringify(tokenData)
		const inscription = Inscription.fromText(
			jsonContent,
			'application/bsv-20',
			options,
		)

		return new BSV20(tokenData, inscription)
	}

	/**
	 * Creates a transfer operation for moving BSV-20 tokens
	 *
	 * @param ticker - Token ticker to transfer
	 * @param amount - Amount to transfer
	 * @param options - Optional inscription parameters
	 * @returns A new BSV20 instance
	 */
	static transfer(
		ticker: string,
		amount: bigint,
		options: BSV20Options = {},
	): BSV20 {
		// Validate parameters
		if (ticker == null || ticker === '' || ticker.length === 0) {
			throw new Error('Ticker cannot be empty')
		}
		if (ticker.length > 32) {
			throw new Error('Ticker cannot exceed 32 characters')
		}
		if (amount <= BigInt(0)) {
			throw new Error('Amount must be positive')
		}

		// Create token data
		const tokenData: BSV20TokenData = {
			p: 'bsv-20',
			op: 'transfer',
			tick: ticker,
			amt: amount.toString(),
		}

		// Create inscription with token JSON
		const jsonContent = JSON.stringify(tokenData)
		const inscription = Inscription.fromText(
			jsonContent,
			'application/bsv-20',
			options,
		)

		return new BSV20(tokenData, inscription)
	}

	/**
	 * Creates a burn operation for permanently destroying BSV-20 tokens
	 *
	 * @param ticker - Token ticker to burn
	 * @param amount - Amount to burn
	 * @param options - Optional inscription parameters
	 * @returns A new BSV20 instance
	 */
	static burn(
		ticker: string,
		amount: bigint,
		options: BSV20Options = {},
	): BSV20 {
		// Validate parameters
		if (ticker == null || ticker === '' || ticker.length === 0) {
			throw new Error('Ticker cannot be empty')
		}
		if (ticker.length > 32) {
			throw new Error('Ticker cannot exceed 32 characters')
		}
		if (amount <= BigInt(0)) {
			throw new Error('Amount must be positive')
		}

		// Create token data
		const tokenData: BSV20TokenData = {
			p: 'bsv-20',
			op: 'burn',
			tick: ticker,
			amt: amount.toString(),
		}

		// Create inscription with token JSON
		const jsonContent = JSON.stringify(tokenData)
		const inscription = Inscription.fromText(
			jsonContent,
			'application/bsv-20',
			options,
		)

		return new BSV20(tokenData, inscription)
	}

	/**
	 * Decodes a BSV-20 token from a script
	 *
	 * @param script - The script containing BSV-20 token data
	 * @returns Decoded BSV-20 token or null if not found/invalid
	 */
	static decode(script: Script): BSV20 | null {
		try {
			// First decode as inscription
			const inscription = Inscription.decode(script)
			if (inscription == null) return null

			// Check if it's BSV-20 token (application/bsv-20 MIME type)
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

			// Parse operation
			const operation = data.op.toLowerCase() as BSV20Operation
			if (!['deploy', 'mint', 'transfer', 'burn'].includes(operation))
				return null

			// Validate operation-specific fields
			switch (operation) {
				case 'deploy':
					if (data.tick == null || typeof data.tick !== 'string') return null
					if (data.tick.length === 0 || data.tick.length > 32) return null
					if (data.max == null || typeof data.max !== 'string') return null
					try {
						const maxSupply = BigInt(data.max)
						if (maxSupply <= BigInt(0)) return null
					} catch {
						return null
					}
					if (data.dec !== undefined) {
						// dec must be a string in the JSON - reject if it's a JS number
						if (typeof data.dec !== 'string') return null
						const dec = Number.parseInt(data.dec, 10)
						if (Number.isNaN(dec)) return null
						if (dec < 0 || dec > 18) return null
						// Normalize to number for tokenData
						data.dec = dec
					}
					if (data.lim !== undefined) {
						if (typeof data.lim !== 'string') return null
						try {
							const limit = BigInt(data.lim)
							if (limit <= BigInt(0)) return null
						} catch {
							return null
						}
					}
					break

				case 'mint':
				case 'transfer':
				case 'burn':
					if (data.tick == null || typeof data.tick !== 'string') return null
					if (data.tick.length === 0 || data.tick.length > 32) return null
					if (data.amt == null || typeof data.amt !== 'string') return null
					try {
						const amount = BigInt(data.amt)
						if (amount <= BigInt(0)) return null
					} catch {
						return null
					}
					break
			}

			// Create token data structure
			const tokenData: BSV20TokenData = {
				p: 'bsv-20',
				op: operation,
				amt: data.amt ?? '0',
			}

			// Add operation-specific fields
			if (operation === 'deploy') {
				tokenData.tick = data.tick
				tokenData.max = data.max
				if (data.dec !== undefined) {
					tokenData.dec = data.dec
				}
				if (data.lim !== undefined) {
					tokenData.lim = data.lim
				}
			} else {
				tokenData.tick = data.tick
			}

			return new BSV20(tokenData, inscription)
		} catch {
			return null
		}
	}

	/**
	 * Creates a locking script containing the BSV-20 token inscription
	 *
	 * @param lockingScript - Optional locking script to append as suffix
	 * @returns A locking script containing the token data
	 */
	lock(lockingScript?: LockingScript): LockingScript {
		if (lockingScript != null) {
			// Create new inscription with the locking script as suffix
			const options: BSV20Options = {
				parent: this.inscription.parent,
				scriptPrefix: this.inscription.scriptPrefix,
				scriptSuffix: lockingScript,
			}

			// Create new inscription with suffix
			const jsonContent = JSON.stringify(this.tokenData)
			const newInscription = Inscription.fromText(
				jsonContent,
				'application/bsv-20',
				options,
			)
			return newInscription.lock()
		}

		return this.inscription.lock()
	}

	/**
	 * BSV-20 tokens cannot be unlocked directly as they are data containers
	 *
	 * @throws Error indicating unlock is not supported
	 */
	unlock(): {
		sign: () => Promise<UnlockingScript>
		estimateLength: () => Promise<number>
	} {
		throw new Error('BSV-20 tokens cannot be unlocked directly')
	}

	/**
	 * Gets the token amount as BigInt
	 *
	 * @returns Token amount
	 */
	getAmount(): bigint {
		return BigInt(this.tokenData.amt)
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
	 * Gets the token ticker/symbol
	 *
	 * @returns Token ticker
	 */
	getTicker(): string | undefined {
		return this.tokenData.tick
	}

	/**
	 * Gets the token ticker/symbol (concise method)
	 *
	 * @returns Token ticker
	 */
	ticker(): string | undefined {
		return this.getTicker()
	}

	/**
	 * Gets the number of decimal places (for deploy operations)
	 *
	 * @returns Number of decimals, defaults to 0
	 */
	getDecimals(): number {
		return this.tokenData.dec ?? 0
	}

	/**
	 * Gets the maximum supply (for deploy operations)
	 *
	 * @returns Maximum supply as BigInt or undefined
	 */
	getMaxSupply(): bigint | undefined {
		return this.tokenData.max != null ? BigInt(this.tokenData.max) : undefined
	}

	/**
	 * Gets the limit per mint operation (for deploy operations)
	 *
	 * @returns Limit per mint as BigInt or undefined
	 */
	getLimitPerMint(): bigint | undefined {
		return this.tokenData.lim != null ? BigInt(this.tokenData.lim) : undefined
	}

	/**
	 * Gets the token operation type
	 *
	 * @returns The operation (deploy, mint, transfer, or burn)
	 */
	getOperation(): BSV20Operation {
		return this.tokenData.op
	}

	/**
	 * Gets the token operation type (concise method)
	 *
	 * @returns The operation (deploy, mint, transfer, or burn)
	 */
	operation(): BSV20Operation {
		return this.getOperation()
	}

	/**
	 * Checks if this is a deploy operation
	 *
	 * @returns true for deploy operations
	 */
	isDeploy(): boolean {
		return this.tokenData.op === 'deploy'
	}

	/**
	 * Checks if this is a mint operation
	 *
	 * @returns true for mint operations
	 */
	isMint(): boolean {
		return this.tokenData.op === 'mint'
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

	/**
	 * Validates the token data structure
	 *
	 * @returns true if token data is valid
	 */
	validate(): boolean {
		try {
			// Validate basic structure
			if (this.tokenData.p !== 'bsv-20') return false
			if (this.tokenData.op == null) return false

			// Validate operation-specific fields
			switch (this.tokenData.op) {
				case 'deploy':
					if (
						this.tokenData.tick == null ||
						this.tokenData.tick === '' ||
						this.tokenData.tick.length === 0 ||
						this.tokenData.tick.length > 32
					) {
						return false
					}
					if (this.tokenData.max == null || this.tokenData.max === '')
						return false
					try {
						const maxSupply = BigInt(this.tokenData.max)
						if (maxSupply <= BigInt(0)) return false
					} catch {
						return false
					}
					if (
						this.tokenData.dec !== undefined &&
						(this.tokenData.dec < 0 || this.tokenData.dec > 18)
					) {
						return false
					}
					if (this.tokenData.lim !== undefined) {
						try {
							const limit = BigInt(this.tokenData.lim)
							if (limit <= BigInt(0)) return false
						} catch {
							return false
						}
					}
					break

				case 'mint':
				case 'transfer':
				case 'burn':
					if (
						this.tokenData.tick == null ||
						this.tokenData.tick === '' ||
						this.tokenData.tick.length === 0 ||
						this.tokenData.tick.length > 32
					) {
						return false
					}
					if (this.tokenData.amt == null || this.tokenData.amt === '')
						return false
					try {
						const amount = BigInt(this.tokenData.amt)
						if (amount <= BigInt(0)) return false
					} catch {
						return false
					}
					break

				default:
					return false
			}

			return true
		} catch {
			return false
		}
	}
}
