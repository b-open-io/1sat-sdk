import { LockingScript, OP, Script, Utils } from '@bsv/sdk'

/**
 * Represents a protocol within a transaction
 */
export interface Protocol {
	protocol: string
	script: number[]
	pos: number
}

/**
 * Represents a BitCom protocol within a transaction (deprecated - use Protocol)
 * @deprecated Use Protocol instead
 */
export interface BitComProtocol extends Protocol {
	protocol: string
	script: number[]
	pos: number
}

/**
 * Represents the complete BitCom structure of a transaction
 */
export interface BitComDecoded {
	protocols: Protocol[]
	scriptPrefix: number[]
}

/**
 * BitCom template for handling multi-protocol Bitcoin transactions
 *
 * BitCom allows multiple protocols to be embedded in a single transaction output
 * using the pipe ('|') delimiter to separate different protocol sections.
 *
 * This implementation mirrors the Go template structure and behavior.
 */
export default class BitCom {
	protocols: Protocol[]
	scriptPrefix: number[]

	constructor(protocols: Protocol[] = [], scriptPrefix: number[] = []) {
		this.protocols = protocols
		this.scriptPrefix = scriptPrefix
	}

	/**
	 * Decodes a script to extract BitCom protocol data
	 *
	 * Mirrors the Go implementation's decode algorithm exactly.
	 *
	 * @param script - The script to decode
	 * @returns BitComDecoded - The decoded BitCom structure, or null if no OP_RETURN found
	 */
	static decode(script: Script | LockingScript): BitComDecoded | null {
		// Handle null script safely - return empty structure like Go
		if (script == null) {
			return {
				protocols: [],
				scriptPrefix: [],
			}
		}

		let scriptBytes: number[]
		if (script instanceof LockingScript) {
			scriptBytes = script.toBinary()
		} else {
			scriptBytes = script.toBinary()
		}

		const pos = BitCom.findReturn(scriptBytes, 0)
		if (pos === -1) {
			return null
		}

		// Get prefix if present (matches Go: prefix = (*scr)[:pos])
		let prefix: number[] = []
		if (pos > 0) {
			prefix = scriptBytes.slice(0, pos)
		}

		const bitcom: BitComDecoded = {
			scriptPrefix: prefix,
			protocols: [],
		}

		// Start after OP_RETURN (matches Go: pos++)
		const currentPos = pos + 1

		// Parse protocols using SDK's built-in parsing (no custom readOp functions)
		const remainingScript = Script.fromBinary(scriptBytes.slice(currentPos))
		const chunks = remainingScript.chunks

		let chunkIndex = 0
		let currentProtocolPos = currentPos

		while (chunkIndex < chunks.length) {
			const protocol: Protocol = {
				protocol: '',
				script: [],
				pos: currentProtocolPos,
			}

			// Read protocol identifier from current chunk
			const protocolChunk = chunks[chunkIndex]
			if (protocolChunk.data == null) {
				break
			}
			protocol.protocol = Utils.toUTF8(protocolChunk.data)
			chunkIndex++

			// Collect script chunks until we find a pipe delimiter or reach end
			const protocolChunks: unknown[] = []
			while (chunkIndex < chunks.length) {
				const chunk = chunks[chunkIndex]

				// Check if this chunk is a pipe delimiter
				if (
					chunk.data != null &&
					chunk.data.length === 1 &&
					chunk.data[0] === 0x7c
				) {
					// Found pipe delimiter - end current protocol
					chunkIndex++ // Skip the pipe
					break
				}

				// Add chunk to current protocol (preserve chunk structure)
				protocolChunks.push(chunk)
				chunkIndex++
			}

			// Convert chunks back to binary for protocol.script
			const protocolScript = new Script(protocolChunks as never[])
			protocol.script = protocolScript.toBinary()
			bitcom.protocols.push(protocol)

			// Update position for next protocol
			currentProtocolPos +=
				protocolChunk.op +
				1 +
				protocol.script.length +
				(chunkIndex < chunks.length ? 2 : 0) // +2 for pipe delimiter
		}

		return bitcom
	}

	/**
	 * Creates a locking script from the BitCom structure
	 *
	 * Mirrors the Go Lock() method exactly.
	 *
	 * @returns LockingScript - The BitCom locking script
	 */
	lock(): LockingScript {
		const script = new Script()

		// Add prefix if present (matches Go: s := script.NewFromBytes(b.ScriptPrefix))
		if (this.scriptPrefix.length > 0) {
			script.writeBin(this.scriptPrefix)
		}

		if (this.protocols.length > 0) {
			// Add OP_RETURN (matches Go: _ = s.AppendOpcodes(script.OpRETURN))
			script.writeOpCode(OP.OP_RETURN)

			for (let i = 0; i < this.protocols.length; i++) {
				const protocol = this.protocols[i]

				// Add protocol identifier as push data (matches Go: _ = s.AppendPushData([]byte(p.Protocol)))
				const protocolBytes = Utils.toArray(protocol.protocol, 'utf8')
				script.writeBin(protocolBytes)

				// Add protocol script data directly (matches Go: s = script.NewFromBytes(append(*s, p.Script...)))
				if (protocol.script.length > 0) {
					// Parse the protocol script to get its chunks and append them
					const protocolScript = Script.fromBinary(protocol.script)
					for (const chunk of protocolScript.chunks) {
						if (chunk.data != null) {
							script.writeBin(chunk.data)
						} else {
							script.writeOpCode(chunk.op)
						}
					}
				}

				// Add pipe delimiter if not the last protocol (matches Go: _ = s.AppendPushData([]byte("|")))
				if (i < this.protocols.length - 1) {
					const pipeBytes = Utils.toArray('|', 'utf8')
					script.writeBin(pipeBytes)
				}
			}
		}

		return new LockingScript(script.chunks)
	}

	/**
	 * Finds the position of OP_RETURN in the script
	 *
	 * Mirrors the Go findReturn function exactly.
	 *
	 * @param scriptBytes - The script bytes to search
	 * @param from - Starting position
	 * @returns number - Position of OP_RETURN, or -1 if not found
	 */
	private static findReturn(scriptBytes: number[], from: number): number {
		let i = from
		while (i < scriptBytes.length) {
			const opcode = scriptBytes[i]
			if (opcode === OP.OP_RETURN) return i

			// Skip pushed data instead of scanning through it for a byte that only
			// happens to equal OP_RETURN (0x6a). MIME types such as ord-fs/json
			// contain that byte and previously hid the real BitCom tape.
			if (opcode >= 1 && opcode <= 75) {
				i += 1 + opcode
				continue
			}
			if (opcode === OP.OP_PUSHDATA1) {
				if (i + 1 >= scriptBytes.length) return -1
				i += 2 + scriptBytes[i + 1]
				continue
			}
			if (opcode === OP.OP_PUSHDATA2) {
				if (i + 2 >= scriptBytes.length) return -1
				const length = scriptBytes[i + 1] | (scriptBytes[i + 2] << 8)
				i += 3 + length
				continue
			}
			if (opcode === OP.OP_PUSHDATA4) {
				if (i + 4 >= scriptBytes.length) return -1
				const length =
					(scriptBytes[i + 1] |
						(scriptBytes[i + 2] << 8) |
						(scriptBytes[i + 3] << 16) |
						(scriptBytes[i + 4] << 24)) >>>
					0
				i += 5 + length
				continue
			}

			i++
		}
		return -1
	}

	/**
	 * Converts various input types to a Script object
	 *
	 * Mirrors the Go ToScript function exactly.
	 *
	 * @param data - The data to convert (Script, LockingScript, or byte array)
	 * @returns Script - The converted script, or null if conversion fails
	 */
	static toScript(data: Script | LockingScript | number[]): Script | null {
		if (data instanceof Script) {
			return data
		}
		if (data instanceof LockingScript) {
			return new Script(data.chunks)
		}
		if (Array.isArray(data)) {
			if (data.length === 0) {
				return new Script()
			}
			return Script.fromBinary(data)
		}
		return null
	}
}
