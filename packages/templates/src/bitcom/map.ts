import { MAP_PREFIX } from '@1sat/types'
import { type LockingScript, Script, Utils } from '@bsv/sdk'
import BitCom, { type Protocol } from './bitcom.js'

export { MAP_PREFIX }

/**
 * MAP protocol commands
 */
export enum MAPCommand {
	SET = 'SET',
	DEL = 'DEL',
	ADD = 'ADD',
	SELECT = 'SELECT',
}

/**
 * MAP protocol data structure
 */
export interface MAPData {
	cmd: MAPCommand | string
	data: Record<string, string>
	adds?: string[]
}

/**
 * MAP (Metadata and Payload) Protocol Template
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
		const data: Record<string, string> = {}
		data[key] = values.join(' ') // Join values with space
		return MAP.lock(MAPCommand.ADD, data)
	}

	/**
	 * Creates a MAP protocol locking script with DEL command
	 *
	 * @param keys - Array of keys to delete
	 * @returns LockingScript - The MAP protocol locking script
	 */
	static del(keys: string[]): LockingScript {
		const data: Record<string, string> = {}
		for (const key of keys) {
			data[key] = ''
		}
		return MAP.lock(MAPCommand.DEL, data)
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
		} else if (cmd === MAPCommand.DEL) {
			// For DEL command, read all keys to delete
			for (let i = 1; i < chunks.length; i++) {
				const keyChunk = chunks[i]
				if (keyChunk?.data != null) {
					const key = MAP.cleanString(Utils.toUTF8(keyChunk.data))
					mapData.data[key] = ''
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
