import type { RpcMethod } from './types'

/**
 * Protocol version for compatibility checking
 */
export const PROTOCOL_VERSION = '1.0.0'

/**
 * Message type identifiers
 */
export const MessageTypes = {
	REQUEST: 'onesat:request',
	RESPONSE: 'onesat:response',
} as const

export type MessageType = (typeof MessageTypes)[keyof typeof MessageTypes]

/**
 * Base message structure
 */
export interface BaseMessage {
	type: MessageType
	version: string
	requestId: string
	origin: string
}

/**
 * Request message from dApp to wallet
 */
export interface RequestMessage extends BaseMessage {
	type: typeof MessageTypes.REQUEST
	method: RpcMethod
	params: unknown
}

/**
 * Response message from wallet to dApp
 */
export interface ResponseMessage extends BaseMessage {
	type: typeof MessageTypes.RESPONSE
	result?: unknown
	error?: {
		code: number
		message: string
		data?: unknown
	}
}

export type ProtocolMessage = RequestMessage | ResponseMessage

/**
 * Create a request message
 */
export function createRequest(
	requestId: string,
	method: RpcMethod,
	params: unknown,
	origin: string,
): RequestMessage {
	return {
		type: MessageTypes.REQUEST,
		version: PROTOCOL_VERSION,
		requestId,
		origin,
		method,
		params,
	}
}

/**
 * Create a success response message
 */
export function createResponse(
	requestId: string,
	result: unknown,
	origin: string,
): ResponseMessage {
	return {
		type: MessageTypes.RESPONSE,
		version: PROTOCOL_VERSION,
		requestId,
		origin,
		result,
	}
}

/**
 * Create an error response message
 */
export function createErrorResponse(
	requestId: string,
	code: number,
	message: string,
	origin: string,
	data?: unknown,
): ResponseMessage {
	return {
		type: MessageTypes.RESPONSE,
		version: PROTOCOL_VERSION,
		requestId,
		origin,
		error: { code, message, data },
	}
}

/**
 * Validate that a message conforms to the protocol
 */
export function isValidMessage(data: unknown): data is ProtocolMessage {
	if (typeof data !== 'object' || data === null) return false

	const msg = data as Record<string, unknown>

	if (typeof msg.type !== 'string') return false
	if (typeof msg.version !== 'string') return false
	if (typeof msg.requestId !== 'string') return false
	if (typeof msg.origin !== 'string') return false

	if (msg.type === MessageTypes.REQUEST) {
		if (typeof msg.method !== 'string') return false
		return true
	}

	if (msg.type === MessageTypes.RESPONSE) {
		return true
	}

	return false
}

/**
 * Check if message is a response
 */
export function isResponse(msg: ProtocolMessage): msg is ResponseMessage {
	return msg.type === MessageTypes.RESPONSE
}
