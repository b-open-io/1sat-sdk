import {
	Hash,
	LockingScript,
	OP,
	Script,
	type ScriptTemplate,
	type Transaction,
	type UnlockingScript,
	Utils,
} from '@bsv/sdk'

/**
 * Interface representing an inscription file
 */
export interface InscriptionFile {
	/** SHA256 hash of the content */
	hash: Uint8Array
	/** Size of the content in bytes */
	size: number
	/** MIME type of the content */
	type: string
	/** The actual file content */
	content: Uint8Array
}

/**
 * Interface for inscription creation options
 */
export interface InscriptionOptions {
	/** Optional parent inscription reference (36-byte outpoint) */
	parent?: Uint8Array
	/** Optional script prefix to prepend before inscription (e.g., P2PKH locking script) */
	scriptPrefix?: Script | LockingScript
	/** Optional script suffix to append after inscription (e.g., OP_RETURN data) */
	scriptSuffix?: Script | LockingScript
}

/**
 * Inscription class implementing ScriptTemplate for Bitcoin ordinals and on-chain data storage.
 *
 * Inscriptions enable embedding arbitrary files, data, and content directly into blockchain
 * transactions using the script pattern: OP_0 OP_IF "ord" OP_1 [MIME_TYPE] OP_0 [CONTENT] OP_ENDIF
 *
 * @example
 * ```typescript
 * // Create inscription from text
 * const inscription = Inscription.fromText("Hello, BSV!", "text/plain");
 * const lockingScript = inscription.lock();
 *
 * // Create inscription from binary data
 * const imageData = new Uint8Array([...]); // PNG image data
 * const imageInscription = Inscription.create(imageData, "image/png");
 *
 * // Parse inscription from script
 * const parsed = Inscription.decode(someScript);
 * if (parsed) {
 *   console.log(`Content type: ${parsed.file.type}`);
 *   console.log(`Content size: ${parsed.file.size} bytes`);
 * }
 * ```
 */
export default class Inscription implements ScriptTemplate {
	/** Inscription file data */
	public readonly file: InscriptionFile
	/** Optional parent inscription reference */
	public readonly parent?: Uint8Array
	/** Optional script prefix */
	public readonly scriptPrefix?: Script | LockingScript
	/** Optional script suffix */
	public readonly scriptSuffix?: Script | LockingScript
	/** Unknown/custom fields (field number -> data) */
	public readonly fields?: Map<string, Uint8Array>

	/**
	 * Creates a new Inscription instance
	 *
	 * @param file - The inscription file data
	 * @param parent - Optional parent inscription reference (32 or 36-byte outpoint)
	 * @param scriptPrefix - Optional script prefix (Script or LockingScript)
	 * @param scriptSuffix - Optional script suffix (Script or LockingScript)
	 * @param fields - Optional map of unknown/custom fields
	 */
	constructor(
		file: InscriptionFile,
		parent?: Uint8Array,
		scriptPrefix?: Script | LockingScript,
		scriptSuffix?: Script | LockingScript,
		fields?: Map<string, Uint8Array>,
	) {
		this.file = file
		this.parent = parent
		this.scriptPrefix = scriptPrefix
		this.scriptSuffix = scriptSuffix
		this.fields = fields
	}

	/**
	 * Creates an inscription locking script following the ordinals protocol format:
	 * [ScriptPrefix] OP_0 OP_IF "ord" OP_1 [MIME_TYPE] OP_0 [CONTENT] OP_ENDIF [ScriptSuffix]
	 *
	 * @returns A locking script containing the inscription data
	 */
	lock(): LockingScript {
		const script = new Script()

		// Add script prefix if present - iterate over chunks to preserve data pushes
		if (this.scriptPrefix != null) {
			for (const chunk of this.scriptPrefix.chunks) {
				script.chunks.push(chunk)
			}
		}

		// Start inscription envelope: OP_0 OP_IF
		script.writeOpCode(OP.OP_0)
		script.writeOpCode(OP.OP_IF)

		// Protocol identifier: "ord"
		script.writeBin(Utils.toArray('ord', 'utf8'))

		// Add MIME type (field 1)
		script.writeOpCode(OP.OP_1)
		script.writeBin(Utils.toArray(this.file.type, 'utf8'))

		// Add parent if present (field 3)
		if (this.parent != null && this.parent.length === 36) {
			script.writeOpCode(OP.OP_3)
			script.writeBin(Array.from(this.parent))
		}

		// Add content (field 0)
		script.writeOpCode(OP.OP_0)
		script.writeBin(Array.from(this.file.content))

		// End inscription envelope: OP_ENDIF
		script.writeOpCode(OP.OP_ENDIF)

		// Add script suffix if present - iterate over chunks to preserve data pushes
		if (this.scriptSuffix != null) {
			for (const chunk of this.scriptSuffix.chunks) {
				script.chunks.push(chunk)
			}
		}

		return new LockingScript(script.chunks)
	}

	/**
	 * Unlock method is not applicable for inscription scripts.
	 * Inscriptions are typically used in outputs that don't require unlocking.
	 *
	 * @throws Error indicating unlock is not supported
	 */
	unlock(): {
		sign: (tx: Transaction, inputIndex: number) => Promise<UnlockingScript>
		estimateLength: () => Promise<number>
	} {
		throw new Error('Unlock is not supported for inscription scripts')
	}

	/**
	 * Verifies that the file hash matches the content
	 *
	 * @returns true if the hash is valid, false otherwise
	 */
	verify(): boolean {
		const calculatedHash = Hash.sha256(Array.from(this.file.content))
		return (
			Utils.toHex(calculatedHash) === Utils.toHex(Array.from(this.file.hash))
		)
	}

	/**
	 * Creates a new inscription from content and MIME type
	 *
	 * @param content - The file content as bytes
	 * @param contentType - The MIME type of the content
	 * @param options - Optional inscription parameters
	 * @returns A new Inscription instance
	 */
	static create(
		content: Uint8Array,
		contentType: string,
		options: InscriptionOptions = {},
	): Inscription {
		// Validate MIME type
		if (contentType === '' || contentType.length > 255) {
			throw new Error(
				'Content type must be a non-empty string with max 255 characters',
			)
		}

		// Validate UTF-8 encoding for content type
		try {
			Utils.toArray(contentType, 'utf8')
		} catch {
			throw new Error('Content type must be valid UTF-8')
		}

		// Validate parent if provided
		if (options.parent != null && options.parent.length !== 36) {
			throw new Error('Parent must be exactly 36 bytes (transaction outpoint)')
		}

		// Calculate hash and create file structure
		const hash = new Uint8Array(Hash.sha256(Array.from(content)))
		const file: InscriptionFile = {
			hash,
			size: content.length,
			type: contentType,
			content,
		}

		return new Inscription(
			file,
			options.parent,
			options.scriptPrefix,
			options.scriptSuffix,
		)
	}

	/**
	 * Creates an inscription from text content
	 *
	 * @param text - The text content
	 * @param contentType - Optional MIME type (defaults to "text/plain;charset=utf-8")
	 * @param options - Optional inscription parameters
	 * @returns A new Inscription instance
	 */
	static fromText(
		text: string,
		contentType = 'text/plain;charset=utf-8',
		options: InscriptionOptions = {},
	): Inscription {
		const content = new Uint8Array(Utils.toArray(text, 'utf8'))
		return Inscription.create(content, contentType, options)
	}

	/**
	 * Creates an inscription from a browser File object
	 *
	 * @param file - The File object
	 * @param options - Optional inscription parameters
	 * @returns Promise resolving to a new Inscription instance
	 */
	static async fromFile(
		file: File,
		options: InscriptionOptions = {},
	): Promise<Inscription> {
		const arrayBuffer = await file.arrayBuffer()
		const content = new Uint8Array(arrayBuffer)
		const contentType =
			file.type !== '' ? file.type : 'application/octet-stream'
		return Inscription.create(content, contentType, options)
	}

	/**
	 * Checks if a script contains an inscription
	 *
	 * @param script - The script to check
	 * @returns true if the script contains an inscription pattern
	 */
	static isInscription(script: Script): boolean {
		try {
			const chunks = script.chunks

			// Look for the pattern: OP_0 OP_IF "ord"
			for (let i = 0; i < chunks.length - 2; i++) {
				const chunk0 = chunks[i]
				const chunk1 = chunks[i + 1]
				const chunk2 = chunks[i + 2]
				if (
					chunk0?.op === OP.OP_0 &&
					chunk1?.op === OP.OP_IF &&
					chunk2?.data != null &&
					chunk2.data.length === 3 &&
					Utils.toUTF8(chunk2.data) === 'ord'
				) {
					return true
				}
			}

			return false
		} catch {
			return false
		}
	}

	/**
	 * Decodes an inscription from a script
	 *
	 * @param script - The script containing inscription data
	 * @returns Decoded inscription or null if not found/invalid
	 */
	static decode(script: Script): Inscription | null {
		try {
			const chunks = script.chunks

			// Find inscription pattern: OP_0 OP_IF "ord"
			let inscriptionStart = -1
			for (let i = 0; i < chunks.length - 2; i++) {
				const chunk0 = chunks[i]
				const chunk1 = chunks[i + 1]
				const chunk2 = chunks[i + 2]
				if (
					chunk0?.op === OP.OP_0 &&
					chunk1?.op === OP.OP_IF &&
					chunk2?.data != null &&
					chunk2.data.length === 3 &&
					Utils.toUTF8(chunk2.data) === 'ord'
				) {
					inscriptionStart = i
					break
				}
			}

			if (inscriptionStart === -1) {
				return null
			}

			// Extract prefix (everything before inscription) - preserve as Script with proper chunks
			let scriptPrefix: Script | undefined
			if (inscriptionStart > 0) {
				scriptPrefix = new Script()
				for (let i = 0; i < inscriptionStart; i++) {
					scriptPrefix.chunks.push(chunks[i])
				}
			}

			// Parse inscription fields
			let pos = inscriptionStart + 3 // Skip OP_0 OP_IF "ord"
			let contentType = ''
			let content = new Uint8Array(0)
			let parent: Uint8Array | undefined
			const fields = new Map<string, Uint8Array>()

			while (pos < chunks.length) {
				if (chunks[pos].op === OP.OP_ENDIF) {
					pos++
					break
				}

				// Read field number/key
				const fieldChunk = chunks[pos]
				let fieldNum: number | undefined
				let fieldKey: string | undefined

				// Handle OP codes for field numbers
				if (fieldChunk.op === OP.OP_0) {
					fieldNum = 0
				} else if (
					fieldChunk.op !== undefined &&
					fieldChunk.op > OP.OP_PUSHDATA4 &&
					fieldChunk.op <= OP.OP_16
				) {
					fieldNum = fieldChunk.op - 80 // OP_1 = 81, so OP_1 - 80 = 1
				} else if (fieldChunk.data != null && fieldChunk.data.length === 1) {
					// Single byte data as field number
					fieldNum = fieldChunk.data[0]
				} else if (fieldChunk.data != null && fieldChunk.data.length > 1) {
					// Multi-byte data as string key (like Go implementation)
					fieldKey = String.fromCharCode(...fieldChunk.data)
				} else {
					// Unknown field format, skip
					pos++
					continue
				}

				pos++

				// Read data
				const dataChunk = chunks[pos]
				if (pos >= chunks.length) {
					break
				}

				// Data chunk may be empty or have data
				const data =
					dataChunk?.data != null
						? new Uint8Array(dataChunk.data)
						: new Uint8Array(0)
				pos++

				// Process field based on number or key
				if (fieldKey != null) {
					// String key field - store in fields map
					fields.set(fieldKey, data)
				} else if (fieldNum !== undefined) {
					switch (fieldNum) {
						case 0: // Content
							content = data
							break
						case 1: // MIME type
							try {
								contentType = Utils.toUTF8(Array.from(data))
							} catch {
								// Invalid UTF-8, use empty string
								contentType = ''
							}
							break
						case 3: // Parent - accept both 32 and 36 bytes (like Go)
							if (data.length === 36) {
								parent = data
							} else if (data.length === 32) {
								// 32-byte txid only - create 36-byte outpoint with vout=0
								parent = new Uint8Array(36)
								parent.set(data, 0)
								// Last 4 bytes are already 0 (vout = 0)
							}
							break
						default:
							// Store unknown numeric fields in fields map
							fields.set(fieldNum.toString(), data)
					}
				}
			}

			// Extract suffix (everything after OP_ENDIF) - preserve as Script with proper chunks
			let scriptSuffix: Script | undefined
			if (pos < chunks.length) {
				scriptSuffix = new Script()
				for (let i = pos; i < chunks.length; i++) {
					scriptSuffix.chunks.push(chunks[i])
				}
			}

			// Must have content to be valid
			if (content.length === 0) {
				return null
			}

			// Calculate hash
			const hash = new Uint8Array(Hash.sha256(Array.from(content)))

			const file: InscriptionFile = {
				hash,
				size: content.length,
				type: contentType,
				content,
			}

			return new Inscription(
				file,
				parent,
				scriptPrefix,
				scriptSuffix,
				fields.size > 0 ? fields : undefined,
			)
		} catch {
			return null
		}
	}

	/**
	 * Extracts text content from the inscription if it's a text type
	 *
	 * @returns The text content or null if not text or invalid UTF-8
	 */
	getText(): string | null {
		if (
			!this.file.type.startsWith('text/') &&
			this.file.type !== 'application/json'
		) {
			return null
		}

		try {
			return Utils.toUTF8(Array.from(this.file.content))
		} catch {
			return null
		}
	}

	/**
	 * Parses JSON content from the inscription
	 *
	 * @returns The parsed JSON object or null if not JSON or invalid
	 */
	getJSON<T = unknown>(): T | null {
		const text = this.getText()
		if (text == null) return null

		try {
			return JSON.parse(text) as T
		} catch {
			return null
		}
	}

	/**
	 * Gets the raw content as bytes
	 *
	 * @returns The file content
	 */
	getContent(): Uint8Array {
		return this.file.content
	}

	/**
	 * Gets content as base64 string
	 *
	 * @returns Base64 encoded content
	 */
	getBase64(): string {
		return Utils.toBase64(Array.from(this.file.content))
	}

	/**
	 * Gets content as hex string
	 *
	 * @returns Hex encoded content
	 */
	getHex(): string {
		return Utils.toHex(Array.from(this.file.content))
	}
}
