/**
 * Standard errors for wallet extensions
 * Uses JSON-RPC compatible error codes
 */

import { ErrorCode, type ErrorCodeValue, type ExtensionError } from './types'

/**
 * Base error class for extension errors
 */
export class OneSatExtensionError extends Error {
	readonly code: ErrorCodeValue
	readonly data?: unknown

	constructor(code: ErrorCodeValue, message: string, data?: unknown) {
		super(message)
		this.name = 'OneSatExtensionError'
		this.code = code
		this.data = data
	}

	/**
	 * Convert to serializable error format
	 */
	toJSON(): ExtensionError {
		return {
			code: this.code,
			message: this.message,
			data: this.data,
		}
	}
}

/**
 * User rejected the request (4001)
 */
export class UserRejectedError extends OneSatExtensionError {
	constructor(message = 'User rejected the request') {
		super(ErrorCode.USER_REJECTED, message)
		this.name = 'UserRejectedError'
	}
}

/**
 * Not authorized / not connected (4100)
 */
export class UnauthorizedError extends OneSatExtensionError {
	constructor(message = 'Not authorized. Please connect first.') {
		super(ErrorCode.UNAUTHORIZED, message)
		this.name = 'UnauthorizedError'
	}
}

/**
 * Method not supported (4200)
 */
export class UnsupportedMethodError extends OneSatExtensionError {
	constructor(method?: string) {
		super(
			ErrorCode.UNSUPPORTED_METHOD,
			method ? `Method '${method}' is not supported` : 'Method not supported',
		)
		this.name = 'UnsupportedMethodError'
	}
}

/**
 * Wallet disconnected (4900)
 */
export class DisconnectedError extends OneSatExtensionError {
	constructor(message = 'Wallet is disconnected') {
		super(ErrorCode.DISCONNECTED, message)
		this.name = 'DisconnectedError'
	}
}

/**
 * Internal error (-32603)
 */
export class InternalError extends OneSatExtensionError {
	constructor(message = 'Internal error', data?: unknown) {
		super(ErrorCode.INTERNAL_ERROR, message, data)
		this.name = 'InternalError'
	}
}

/**
 * Invalid parameters (-32602)
 */
export class InvalidParamsError extends OneSatExtensionError {
	constructor(message = 'Invalid parameters') {
		super(ErrorCode.INVALID_PARAMS, message)
		this.name = 'InvalidParamsError'
	}
}

/**
 * Method not found (-32601)
 */
export class MethodNotFoundError extends OneSatExtensionError {
	constructor(method?: string) {
		super(
			ErrorCode.METHOD_NOT_FOUND,
			method ? `Method '${method}' not found` : 'Method not found',
		)
		this.name = 'MethodNotFoundError'
	}
}

/**
 * Convert any error to ExtensionError format
 */
export function toExtensionError(error: unknown): ExtensionError {
	if (error instanceof OneSatExtensionError) {
		return error.toJSON()
	}

	if (error instanceof Error) {
		return {
			code: ErrorCode.INTERNAL_ERROR,
			message: error.message,
		}
	}

	return {
		code: ErrorCode.INTERNAL_ERROR,
		message: String(error),
	}
}

/**
 * Create an error from ExtensionError format
 */
export function fromExtensionError(error: ExtensionError): OneSatExtensionError {
	switch (error.code) {
		case ErrorCode.USER_REJECTED:
			return new UserRejectedError(error.message)
		case ErrorCode.UNAUTHORIZED:
			return new UnauthorizedError(error.message)
		case ErrorCode.UNSUPPORTED_METHOD:
			return new UnsupportedMethodError(error.message)
		case ErrorCode.DISCONNECTED:
			return new DisconnectedError(error.message)
		case ErrorCode.INVALID_PARAMS:
			return new InvalidParamsError(error.message)
		case ErrorCode.METHOD_NOT_FOUND:
			return new MethodNotFoundError(error.message)
		default:
			return new InternalError(error.message, error.data)
	}
}
