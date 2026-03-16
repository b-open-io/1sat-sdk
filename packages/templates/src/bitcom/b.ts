import { type LockingScript, Script, Utils } from '@bsv/sdk'
import BitCom, { type Protocol } from './bitcom.js'

/**
 * B Protocol Prefix - the BitCom protocol address for B
 */
export const B_PREFIX = '19HxigV4QyBv3tHpQVcUEQyq1pzZVdoAut'

/**
 * Media types for B protocol
 */
export enum MediaType {
	TextPlain = 'text/plain',
	TextMarkdown = 'text/markdown',
	TextHTML = 'text/html',
	ImagePNG = 'image/png',
	ImageJPEG = 'image/jpeg',
	ApplicationJSON = 'application/json',
	ApplicationPDF = 'application/pdf',
}

/**
 * Encoding types for B protocol
 */
export enum Encoding {
	UTF8 = 'utf-8',
	Binary = 'binary',
	Base64 = 'base64',
	Hex = 'hex',
}

/**
 * B protocol data structure
 * B PROTOCOL FORMAT: PREFIX DATA MEDIA_TYPE ENCODING FILENAME
 */
export interface BData {
	mediaType: MediaType | string
	encoding: Encoding | string
	data: number[]
	filename?: string
}

/**
 * B (Binary) Protocol Template
 *
 * The B protocol is used for storing arbitrary binary data on the blockchain.
 * It follows the format: PREFIX DATA MEDIA_TYPE ENCODING [FILENAME]
 * where FILENAME is optional.
 */
export default class B {
	/**
	 * Creates a B protocol locking script
	 *
	 * @param data - The binary data to store
	 * @param mediaType - The MIME type of the data
	 * @param encoding - The encoding format
	 * @param filename - Optional filename
	 * @returns LockingScript - The B protocol locking script
	 */
	static lock(
		data: number[] | string | Uint8Array,
		mediaType: MediaType | string = MediaType.TextPlain,
		encoding: Encoding | string = Encoding.UTF8,
		filename?: string,
	): LockingScript {
		// Convert data to number array
		let dataBytes: number[]
		if (typeof data === 'string') {
			if (encoding === Encoding.Hex) {
				dataBytes = Utils.toArray(data, 'hex')
			} else if (encoding === Encoding.Base64) {
				dataBytes = Utils.toArray(data, 'base64')
			} else {
				dataBytes = Utils.toArray(data, 'utf8')
			}
		} else if (data instanceof Uint8Array) {
			dataBytes = Array.from(data)
		} else {
			dataBytes = data
		}

		const protocols: Protocol[] = [
			{
				protocol: B_PREFIX,
				script: [],
				pos: 0,
			},
		]

		// Build the B protocol script: DATA MEDIA_TYPE ENCODING [FILENAME]
		const script = new Script()

		// Add DATA as push data
		script.writeBin(dataBytes)

		// Add MEDIA_TYPE as push data
		script.writeBin(Utils.toArray(mediaType))

		// Add ENCODING as push data
		script.writeBin(Utils.toArray(encoding))

		// Add optional FILENAME as push data
		if (filename != null && filename !== '') {
			script.writeBin(Utils.toArray(filename))
		}

		protocols[0].script = script.toBinary()

		// Create BitCom structure and return locking script
		const bitcom = new BitCom(protocols)
		return bitcom.lock()
	}

	/**
	 * Decodes B protocol data from script
	 *
	 * @param script - The script containing B protocol data
	 * @returns BData - The decoded B protocol data, or null if invalid
	 */
	static decode(script: Script | LockingScript | number[]): BData | null {
		let scriptToProcess: Script | null = null

		if (Array.isArray(script)) {
			scriptToProcess = Script.fromBinary(script)
		} else {
			scriptToProcess = BitCom.toScript(script)
		}

		if (scriptToProcess == null) {
			return null
		}

		// First decode as BitCom to find B protocol
		const bitcomData = BitCom.decode(scriptToProcess)
		if (bitcomData == null) {
			return null
		}

		// Find B protocol in the protocols
		const bProtocol = bitcomData.protocols.find(
			(p: Protocol) => p.protocol === B_PREFIX,
		)
		if (bProtocol == null) {
			return null
		}

		// Parse the B protocol script: DATA MEDIA_TYPE ENCODING [FILENAME]
		const parsedScript = Script.fromBinary(bProtocol.script)
		const chunks = parsedScript.chunks

		if (chunks.length < 3) {
			// Need at least DATA, MEDIA_TYPE, ENCODING
			return null
		}

		// Access parsed chunks directly
		const dataChunk = chunks[0]
		if (dataChunk.data == null) {
			return null
		}
		const data = dataChunk.data

		// Return null for empty data as expected by tests
		if (data.length === 0) return null

		// Read MEDIA_TYPE (second chunk)
		const mediaTypeChunk = chunks[1]
		if (mediaTypeChunk.data == null) {
			return null
		}
		const mediaType = Utils.toUTF8(mediaTypeChunk.data)

		// Read ENCODING (third chunk)
		const encodingChunk = chunks[2]
		if (encodingChunk.data == null) {
			return null
		}
		const encoding = Utils.toUTF8(encodingChunk.data)

		// Try to read optional FILENAME (fourth chunk)
		let filename: string | undefined
		if (chunks.length >= 4) {
			const filenameChunk = chunks[3]
			if (filenameChunk.data != null) {
				filename = Utils.toUTF8(filenameChunk.data)
			}
		}

		return {
			data,
			mediaType,
			encoding,
			filename,
		}
	}

	/**
	 * Helper method to create text content
	 *
	 * @param text - The text content
	 * @param mediaType - Optional media type (defaults to text/plain)
	 * @param filename - Optional filename
	 * @returns LockingScript - The B protocol locking script
	 */
	static text(
		text: string,
		mediaType: MediaType | string = MediaType.TextPlain,
		filename?: string,
	): LockingScript {
		return B.lock(text, mediaType, Encoding.UTF8, filename)
	}

	/**
	 * Helper method to create binary content
	 *
	 * @param data - The binary data
	 * @param mediaType - The media type
	 * @param filename - Optional filename
	 * @returns LockingScript - The B protocol locking script
	 */
	static binary(
		data: number[] | Uint8Array,
		mediaType: MediaType | string,
		filename?: string,
	): LockingScript {
		return B.lock(data, mediaType, Encoding.Binary, filename)
	}

	/**
	 * Helper method to create base64 encoded content
	 *
	 * @param base64Data - The base64 encoded data
	 * @param mediaType - The media type
	 * @param filename - Optional filename
	 * @returns LockingScript - The B protocol locking script
	 */
	static base64(
		base64Data: string,
		mediaType: MediaType | string,
		filename?: string,
	): LockingScript {
		return B.lock(base64Data, mediaType, Encoding.Base64, filename)
	}

	/**
	 * Helper method to create hex encoded content
	 *
	 * @param hexData - The hex encoded data
	 * @param mediaType - The media type
	 * @param filename - Optional filename
	 * @returns LockingScript - The B protocol locking script
	 */
	static hex(
		hexData: string,
		mediaType: MediaType | string,
		filename?: string,
	): LockingScript {
		return B.lock(hexData, mediaType, Encoding.Hex, filename)
	}
}
