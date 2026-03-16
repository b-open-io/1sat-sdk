import {
	type LockingScript,
	Script,
	type ScriptTemplate,
	type Transaction,
	type UnlockingScript,
	Utils,
} from '@bsv/sdk'
import AIP from '../bitcom/aip.js'
import B from '../bitcom/b.js'
import BitCom, { type BitComDecoded } from '../bitcom/bitcom.js'
import MAP from '../bitcom/map.js'
import type { Signer } from '../signer.js'

// Constants for BSocial protocol
const BSOCIAL_APP_NAME = 'bsocial'

// Protocol addresses
const B_PROTOCOL_ADDRESS = '19HxigV4QyBv3tHpQVcUEQyq1pzZVdoAut'
const MAP_PROTOCOL_ADDRESS = '1PuQa7K62MiKCtssSLKy1kh56WWU7MtUR5'
const AIP_PROTOCOL_ADDRESS = '15PciHG22SNLQJXMoSUaWVi7WSqc7hCfva'

// Action types
export enum BSocialActionType {
	POST = 'post',
	LIKE = 'like',
	UNLIKE = 'unlike',
	FOLLOW = 'follow',
	UNFOLLOW = 'unfollow',
	MESSAGE = 'message',
	VIDEO = 'video',
}

// Context types
export enum BSocialContext {
	TX = 'tx',
	CHANNEL = 'channel',
	BAP_ID = 'bapID',
	PROVIDER = 'provider',
	VIDEO_ID = 'videoID',
	GEOHASH = 'geohash',
	BTC_TX = 'btcTx',
	ETH_TX = 'ethTx',
}

// Interfaces
export interface BSocialAction {
	app: string
	type: BSocialActionType
	context?: BSocialContext
	contextValue?: string
	subcontext?: BSocialContext
	subcontextValue?: string
}

export interface BSocialPost extends BSocialAction {
	content: string
	mediaType?: string
	encoding?: string
	filename?: string
}

export interface BSocialLike extends BSocialAction {
	txid: string
}

export interface BSocialFollow extends BSocialAction {
	bapId: string
}

export interface BSocialMessage extends BSocialAction {
	content: string
	mediaType?: string
	encoding?: string
}

export interface BSocialVideo extends BSocialAction {
	provider: string
	videoID: string
	duration?: number
	start?: number
}

export interface BSocialDecoded {
	action: BSocialAction
	content?: string
	attachments?: unknown[]
	tags?: string[][]
	aip?: unknown
}

/**
 * BSocial class implementing ScriptTemplate.
 *
 * This class provides methods to create BSocial protocol transactions for social media
 * actions like posts, likes, follows, etc. following BitcoinSchema.org standards.
 */
export default class BSocial implements ScriptTemplate {
	private readonly action: BSocialAction
	private readonly content?: string
	private readonly tags?: string[]
	private readonly signer?: Signer

	constructor(
		action: BSocialAction,
		content?: string,
		tags?: string[],
		signer?: Signer,
	) {
		this.action = action
		this.content = content
		this.tags = tags
		this.signer = signer
	}

	/**
	 * Creates a BSocial locking script for various social actions
	 *
	 * @returns A locking script for the BSocial action
	 */
	async lock(): Promise<LockingScript> {
		const protocols = []

		// Add B protocol for content (if present and not empty)
		if (this.content !== undefined && this.content !== null) {
			const bScript = B.text(this.content)

			// Extract only the protocol data (skip OP_RETURN and address)
			const bDataChunks = bScript.chunks.slice(2) // Skip OP_RETURN and address
			const bDataScript = new Script(bDataChunks)

			protocols.push({
				protocol: B_PROTOCOL_ADDRESS,
				script: bDataScript.toBinary(),
				pos: protocols.length,
			})
		}

		// Add MAP protocol for action metadata
		const mapData: Record<string, string> = {
			app: BSOCIAL_APP_NAME,
			type: this.action.type,
		}

		if (this.action.context) {
			mapData.context = this.action.context
		}
		if (this.action.contextValue != null && this.action.contextValue !== '') {
			mapData.contextValue = this.action.contextValue
		}
		if (this.action.subcontext) {
			mapData.subcontext = this.action.subcontext
		}
		if (
			this.action.subcontextValue != null &&
			this.action.subcontextValue !== ''
		) {
			mapData.subcontextValue = this.action.subcontextValue
		}

		// Add specific action data
		if (this.action.type === BSocialActionType.LIKE && 'txid' in this.action) {
			mapData.tx = (this.action as BSocialLike).txid
		}
		if (
			this.action.type === BSocialActionType.FOLLOW &&
			'bapId' in this.action
		) {
			mapData.bapId = (this.action as BSocialFollow).bapId
		}
		if (
			this.action.type === BSocialActionType.VIDEO &&
			'provider' in this.action
		) {
			const video = this.action as BSocialVideo
			mapData.context = BSocialContext.VIDEO_ID
			mapData.contextValue = video.videoID
			mapData.subcontext = BSocialContext.PROVIDER
			mapData.subcontextValue = video.provider
			if (video.duration !== undefined) {
				mapData.duration = String(video.duration)
			}
			if (video.start !== undefined) {
				mapData.start = String(video.start)
			}
		}

		// Add tags if present
		if (this.tags != null && this.tags.length > 0) {
			this.tags.forEach((tag, index) => {
				mapData[`tag${index}`] = tag
			})
		}

		const mapScript = MAP.set(mapData)

		// Extract only the protocol data (skip OP_RETURN and address)
		const mapDataChunks = mapScript.chunks.slice(2) // Skip OP_RETURN and address
		const mapDataScript = new Script(mapDataChunks)

		protocols.push({
			protocol: MAP_PROTOCOL_ADDRESS,
			script: mapDataScript.toBinary(),
			pos: protocols.length,
		})

		// Add AIP protocol for signature (if identity key provided)
		if (this.signer != null) {
			// Create data to sign (all protocol data)
			const signatureData = []
			for (const proto of protocols) {
				signatureData.push(...Utils.toArray(proto.protocol, 'utf8'))
				signatureData.push(...proto.script)
				signatureData.push(0x7c) // '|' separator
			}

			const aipData = await AIP.sign(signatureData, this.signer)
			const aipScript = aipData.lock()

			// Extract only the AIP data from the script (skip OP_RETURN and protocol address)
			const aipChunks = aipScript.chunks.slice(2) // Skip OP_RETURN and AIP protocol address
			const aipDataScript = new Script(aipChunks)

			protocols.push({
				protocol: AIP_PROTOCOL_ADDRESS,
				script: aipDataScript.toBinary(),
				pos: protocols.length,
			})
		}

		// Create BitCom transaction
		const bitcom = new BitCom(protocols)
		return bitcom.lock()
	}

	/**
	 * Unlock method is not available for BSocial scripts, throws exception.
	 */
	unlock(): {
		sign: (tx: Transaction, inputIndex: number) => Promise<UnlockingScript>
		estimateLength: () => Promise<number>
	} {
		throw new Error('Unlock is not supported for BSocial scripts')
	}

	/**
	 * Creates a post transaction
	 *
	 * @param post The post data
	 * @param tags Optional tags for the post
	 * @param signer Optional private key for AIP signature
	 * @returns A locking script for the post
	 */
	static async createPost(
		post: BSocialPost,
		tags?: string[],
		signer?: Signer,
	): Promise<LockingScript> {
		const bsocial = new BSocial(post, post.content, tags, signer)
		return await bsocial.lock()
	}

	/**
	 * Creates a like transaction
	 *
	 * @param like The like data
	 * @param signer Optional private key for AIP signature
	 * @returns A locking script for the like
	 */
	static async createLike(
		like: BSocialLike,
		signer?: Signer,
	): Promise<LockingScript> {
		const bsocial = new BSocial(like, undefined, undefined, signer)
		return await bsocial.lock()
	}

	/**
	 * Creates a follow transaction
	 *
	 * @param follow The follow data
	 * @param signer Optional private key for AIP signature
	 * @returns A locking script for the follow
	 */
	static async createFollow(
		follow: BSocialFollow,
		signer?: Signer,
	): Promise<LockingScript> {
		const bsocial = new BSocial(follow, undefined, undefined, signer)
		return await bsocial.lock()
	}

	/**
	 * Decodes a BSocial transaction script
	 *
	 * @param script The script to decode
	 * @returns Decoded BSocial data
	 */
	static decode(script: Script): BSocialDecoded | null {
		try {
			// First decode the BitCom structure
			const bitcom = BitCom.decode(script)
			if (bitcom == null) {
				return null
			}

			let content: string | undefined
			let action: BSocialAction | undefined
			let tags: string[][] = []
			const attachments: unknown[] = []
			let aip: unknown

			// Process each protocol in the BitCom transaction
			for (const protocol of bitcom.protocols) {
				if (protocol.protocol === B_PROTOCOL_ADDRESS) {
					// Parse B protocol data directly: DATA MEDIA_TYPE ENCODING [FILENAME]
					const bScript = Script.fromBinary(protocol.script)
					const chunks = bScript.chunks

					if (chunks.length >= 3) {
						// Need at least DATA, MEDIA_TYPE, ENCODING
						const dataChunk = chunks[0]
						const mediaTypeChunk = chunks[1]
						const encodingChunk = chunks[2]

						if (
							dataChunk.data != null &&
							mediaTypeChunk.data != null &&
							encodingChunk.data != null
						) {
							const mediaType = Utils.toUTF8(mediaTypeChunk.data)
							const encoding = Utils.toUTF8(encodingChunk.data)

							if (mediaType === 'text/plain' && encoding === 'utf-8') {
								content = Utils.toUTF8(dataChunk.data)
							} else {
								attachments.push({
									type: mediaType,
									content: dataChunk.data,
									size: dataChunk.data.length,
									encoding,
								})
							}
						}
					}
				} else if (protocol.protocol === MAP_PROTOCOL_ADDRESS) {
					// Parse MAP protocol data directly: COMMAND key1 value1 key2 value2...
					const mapScript = Script.fromBinary(protocol.script)
					const chunks = mapScript.chunks

					if (chunks.length >= 1) {
						// Read COMMAND (first chunk)
						const cmdChunk = chunks[0]
						if (cmdChunk.data != null) {
							const cmd = Utils.toUTF8(cmdChunk.data)

							// Handle SET command - read key-value pairs
							if (cmd === 'SET') {
								const mapKV: Record<string, string> = {}

								for (let i = 1; i < chunks.length; i += 2) {
									// Read key
									const keyChunk = chunks[i]
									if (keyChunk?.data == null) break

									// Read value (next chunk)
									const valueChunk = chunks[i + 1]
									if (valueChunk?.data == null) break

									const key = Utils.toUTF8(keyChunk.data)
									const value = Utils.toUTF8(valueChunk.data)

									mapKV[key] = value
								}

								const app = mapKV.app
								if (app === BSOCIAL_APP_NAME) {
									const type = mapKV.type as BSocialActionType
									const ctx = mapKV.context as BSocialContext
									const contextValue = mapKV.contextValue
									const subcontext = mapKV.subcontext as BSocialContext
									const subcontextValue = mapKV.subcontextValue

									action = {
										app: BSOCIAL_APP_NAME,
										type,
										context: ctx,
										contextValue,
										subcontext,
										subcontextValue,
									}

									// Extract specific action data
									if (type === BSocialActionType.LIKE) {
										const txid = mapKV.tx
										if (txid != null && txid !== '') {
											;(action as BSocialLike).txid = txid
										}
									} else if (type === BSocialActionType.FOLLOW) {
										const bapId = mapKV.bapId
										if (bapId != null && bapId !== '') {
											;(action as BSocialFollow).bapId = bapId
										}
									} else if (type === BSocialActionType.VIDEO) {
										const videoAction = action as BSocialVideo
										if (contextValue != null && contextValue !== '') {
											videoAction.videoID = contextValue
										}
										if (subcontextValue != null && subcontextValue !== '') {
											videoAction.provider = subcontextValue
										}
										if (mapKV.duration != null && mapKV.duration !== '') {
											videoAction.duration = Number.parseInt(mapKV.duration, 10)
										}
										if (mapKV.start != null && mapKV.start !== '') {
											videoAction.start = Number.parseInt(mapKV.start, 10)
										}
									}

									// Extract tags
									const tagEntries = Object.entries(mapKV).filter(([key]) =>
										key.startsWith('tag'),
									)
									tags = tagEntries.map(([key, value]) => [key, value])
								}
							}
						}
					}
				} else if (protocol.protocol === AIP_PROTOCOL_ADDRESS) {
					// Extract AIP signature data - create BitCom structure for AIP.decode
					const aipBitCom: BitComDecoded = {
						protocols: [protocol],
						scriptPrefix: [],
					}
					const aipDecoded = AIP.decode(aipBitCom)
					if (aipDecoded != null && aipDecoded.length > 0) {
						aip = aipDecoded[0].data
					}
				}
			}

			// Must have action to be valid BSocial transaction
			if (action == null) {
				return null
			}

			return {
				action,
				content,
				attachments,
				tags,
				aip,
			}
		} catch {
			return null
		}
	}

	/**
	 * Signs data with AIP protocol
	 *
	 * @param privateKey The private key to sign with
	 * @param message The message to sign
	 * @returns Base64 encoded signature
	 */
	static async signAIP(signer: Signer, message: string): Promise<string> {
		const messageData = Utils.toArray(message, 'utf8')
		const aipData = await AIP.sign(messageData, signer)
		return Utils.toBase64(aipData.data.signature)
	}

	/**
	 * Creates a reply transaction
	 *
	 * @param reply The reply data
	 * @param replyTxId The transaction ID being replied to
	 * @param tags Optional tags for the reply
	 * @param signer Optional private key for AIP signature
	 * @returns A locking script for the reply
	 */
	static async createReply(
		reply: BSocialPost,
		replyTxId: string,
		tags?: string[],
		signer?: Signer,
	): Promise<LockingScript> {
		const replyAction = {
			...reply,
			context: BSocialContext.TX,
			contextValue: replyTxId,
		}
		const bsocial = new BSocial(replyAction, reply.content, tags, signer)
		return await bsocial.lock()
	}

	/**
	 * Creates a message transaction
	 *
	 * @param message The message data
	 * @param signer Optional private key for AIP signature
	 * @returns A locking script for the message
	 */
	static async createMessage(
		message: BSocialMessage,
		signer?: Signer,
	): Promise<LockingScript> {
		const bsocial = new BSocial(message, message.content, undefined, signer)
		return await bsocial.lock()
	}

	/**
	 * Creates a video transaction
	 *
	 * @param video The video data including provider and videoID
	 * @param signer Optional private key for AIP signature
	 * @returns A locking script for the video
	 */
	static async createVideo(
		video: BSocialVideo,
		signer?: Signer,
	): Promise<LockingScript> {
		const bsocial = new BSocial(video, undefined, undefined, signer)
		return await bsocial.lock()
	}
}
