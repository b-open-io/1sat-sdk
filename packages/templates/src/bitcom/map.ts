import { MAP_PREFIX } from '@1sat/types'
import { type LockingScript, Script, Utils } from '@bsv/sdk'
import BitCom, { type Protocol } from './bitcom.js'

export { MAP_PREFIX }

/**
 * MAP protocol commands
 *
 * Per the Magic Attribute Protocol specification. `SET` and `REMOVE` operate on
 * single-value keys; `ADD` and `DELETE` operate on list-valued keys. `SELECT`
 * designates a transaction as the context for a following command, and `CLEAR`
 * erases every value a transaction wrote.
 *
 * @see https://github.com/opldotdev/MAP
 */
export enum MAPCommand {
	SET = 'SET',
	REMOVE = 'REMOVE',
	ADD = 'ADD',
	DELETE = 'DELETE',
	SELECT = 'SELECT',
	CLEAR = 'CLEAR',
}

/**
 * MAP protocol data structure
 */
export interface MAPData {
	cmd: MAPCommand | string
	data: Record<string, string>
	/** Values appended by an ADD command, in script order */
	adds?: string[]
	/** Values struck by a DELETE command, in script order */
	deletes?: string[]
}

/**
 * MAP (Magic Attribute Protocol) Template
 *
 * The MAP protocol provides a way to store key-value metadata on the blockchain.
 * It supports different commands for setting, deleting, adding, and selecting data.
 */
export default class MAP {
	/**
	 * Creates a MAP protocol locking script with SET command
	 *
	 * @param data - Key-value pairs to set
	 * @returns LockingScript - The MAP protocol locking script
	 */
	static set(data: Record<string, string>): LockingScript {
		return MAP.lock(MAPCommand.SET, data)
	}

	/**
	 * Creates a MAP protocol locking script with ADD command
	 *
	 * @param key - The key to add values to
	 * @param values - Array of values to add
	 * @returns LockingScript - The MAP protocol locking script
	 */
	static add(key: string, values: string[]): LockingScript {
		// ADD names the list key, then writes one push per value. Joining the
		// values into a single push would make an n-member list indistinguishable
		// from a one-member list holding a space-separated string, and would not
		// round-trip through the ADD branch of decode().
		return MAP.lockPushes([MAPCommand.ADD, key, ...values])
	}

	/**
	 * Creates a MAP protocol locking script with a REMOVE command
	 *
	 * REMOVE clears single-value keys. To drop individual members of a
	 * list-valued key, use {@link MAP.delete} instead.
	 *
	 * @param keys - Array of keys to remove
	 * @returns LockingScript - The MAP protocol locking script
	 */
	static remove(keys: string[]): LockingScript {
		// REMOVE names keys only - it takes no values. Routing it through lock()
		// would pad every key with an empty push.
		return MAP.lockPushes([MAPCommand.REMOVE, ...keys])
	}

	/**
	 * Creates a MAP protocol locking script with a DELETE command
	 *
	 * DELETE removes one or more values from a single list-valued key. The key
	 * is named first so that the values are only struck from that list.
	 *
	 * @param key - The list-valued key to delete from
	 * @param values - Values to remove from that list
	 * @returns LockingScript - The MAP protocol locking script
	 */
	static delete(key: string, values: string[]): LockingScript {
		return MAP.lockPushes([MAPCommand.DELETE, key, ...values])
	}

	/**
	 * Builds a BitCom-framed MAP output from an ordered list of pushes
	 *
	 * The list commands (ADD, DELETE) and REMOVE are positional rather than
	 * key/value, so they cannot go through {@link MAP.lock}. They still need the
	 * same `OP_RETURN <MAP_PREFIX> ...` framing, otherwise {@link MAP.decode}
	 * finds no OP_RETURN and returns null.
	 *
	 * @param pushes - The command followed by its operands, in script order
	 * @returns LockingScript - The MAP protocol locking script
	 */
	private static lockPushes(pushes: string[]): LockingScript {
		const script = new Script()
		for (const push of pushes) {
			script.writeBin(Utils.toArray(MAP.cleanString(push)))
		}

		const protocols: Protocol[] = [
			{
				protocol: MAP_PREFIX,
				script: script.toBinary(),
				pos: 0,
			},
		]

		return new BitCom(protocols).lock()
	}

	/**
	 * Creates a MAP protocol locking script
	 *
	 * @param command - The MAP command
	 * @param data - The key-value data
	 * @returns LockingScript - The MAP protocol locking script
	 */
	static lock(
		command: MAPCommand | string,
		data: Record<string, string>,
	): LockingScript {
		const protocols: Protocol[] = [
			{
				protocol: MAP_PREFIX,
				script: [],
				pos: 0,
			},
		]

		// Build the MAP protocol script: CMD KEY1 VALUE1 KEY2 VALUE2 ...
		const script = new Script()

		// Add COMMAND
		script.writeBin(Utils.toArray(command.toString()))

		// Add key-value pairs
		for (const [key, value] of Object.entries(data)) {
			// Add KEY
			script.writeBin(Utils.toArray(MAP.cleanString(key)))

			// Add VALUE
			script.writeBin(Utils.toArray(MAP.cleanString(value)))
		}

		protocols[0].script = script.toBinary()

		// Create BitCom structure and return locking script
		const bitcom = new BitCom(protocols)
		return bitcom.lock()
	}

	/**
	 * Decodes MAP protocol data from script
	 *
	 * @param script - The script containing MAP protocol data
	 * @returns MAPData - The decoded MAP protocol data, or null if invalid
	 */
	static decode(script: Script | LockingScript | number[]): MAPData | null {
		let scriptToProcess: Script | null = null

		if (Array.isArray(script)) {
			scriptToProcess = Script.fromBinary(script)
		} else {
			scriptToProcess = BitCom.toScript(script)
		}

		if (scriptToProcess == null) {
			return null
		}

		// First decode as BitCom to find MAP protocol
		const bitcomData = BitCom.decode(scriptToProcess)
		if (bitcomData == null) {
			return null
		}

		// Find MAP protocol in the protocols
		const mapProtocol = bitcomData.protocols.find(
			(p: Protocol) => p.protocol === MAP_PREFIX,
		)
		if (mapProtocol == null) {
			return null
		}

		// Parse the MAP protocol script using SDK native parsing
		const parsedScript = Script.fromBinary(mapProtocol.script)
		const chunks = parsedScript.chunks

		if (chunks.length < 1) {
			// At least command
			return null
		}

		// Read COMMAND (first chunk)
		const cmdChunk = chunks[0]
		if (cmdChunk.data == null) {
			return null
		}
		const cmd = Utils.toUTF8(cmdChunk.data)

		const mapData: MAPData = {
			cmd,
			data: {},
		}

		// Handle SET command - read key-value pairs
		if (cmd === MAPCommand.SET) {
			for (let i = 1; i < chunks.length; i += 2) {
				// Read key
				const keyChunk = chunks[i]
				if (keyChunk?.data == null) break

				// Read value (next chunk)
				const valueChunk = chunks[i + 1]
				if (valueChunk?.data == null) break

				const key = MAP.cleanString(Utils.toUTF8(keyChunk.data))
				const value = MAP.cleanString(Utils.toUTF8(valueChunk.data))

				mapData.data[key] = value
			}
		} else if (cmd === MAPCommand.ADD) {
			// For ADD command, read key and then all remaining values
			if (chunks.length >= 2) {
				const keyChunk = chunks[1]
				if (keyChunk?.data != null) {
					const key = MAP.cleanString(Utils.toUTF8(keyChunk.data))

					const values: string[] = []
					for (let i = 2; i < chunks.length; i++) {
						const valueChunk = chunks[i]
						if (valueChunk?.data != null) {
							values.push(MAP.cleanString(Utils.toUTF8(valueChunk.data)))
						}
					}

					mapData.data[key] = values.join(' ')
					mapData.adds = values
				}
			}
		} else if (cmd === MAPCommand.REMOVE) {
			// REMOVE clears single-value keys - read every key named
			for (let i = 1; i < chunks.length; i++) {
				const keyChunk = chunks[i]
				if (keyChunk?.data != null) {
					const key = MAP.cleanString(Utils.toUTF8(keyChunk.data))
					mapData.data[key] = ''
				}
			}
		} else if (cmd === MAPCommand.DELETE) {
			// DELETE removes values from one list-valued key: key first, then values
			if (chunks.length >= 2) {
				const keyChunk = chunks[1]
				if (keyChunk?.data != null) {
					const key = MAP.cleanString(Utils.toUTF8(keyChunk.data))

					const values: string[] = []
					for (let i = 2; i < chunks.length; i++) {
						const valueChunk = chunks[i]
						if (valueChunk?.data != null) {
							values.push(MAP.cleanString(Utils.toUTF8(valueChunk.data)))
						}
					}

					mapData.data[key] = values.join(' ')
					mapData.deletes = values
				}
			}
		}

		return mapData
	}

	/**
	 * Cleans a string by replacing null bytes with spaces and handling escape sequences
	 *
	 * @param str - The string to clean
	 * @returns string - The cleaned string
	 */
	private static cleanString(str: string): string {
		return str
			.replace(/\0/g, ' ') // Replace null bytes with spaces
			.replace(/\\u0000/g, ' ') // Replace escaped null bytes with spaces
	}

	/**
	 * Helper method to create a simple key-value MAP
	 *
	 * @param key - The key
	 * @param value - The value
	 * @returns LockingScript - The MAP protocol locking script
	 */
	static keyValue(key: string, value: string): LockingScript {
		return MAP.set({ [key]: value })
	}

	/**
	 * Helper method to create an app identification MAP
	 *
	 * @param appName - The application name
	 * @param type - The action/content type
	 * @param additionalData - Optional additional key-value pairs
	 * @returns LockingScript - The MAP protocol locking script
	 */
	static app(
		appName: string,
		type: string,
		additionalData: Record<string, string> = {},
	): LockingScript {
		const data = {
			app: appName,
			type,
			...additionalData,
		}
		return MAP.set(data)
	}
}
