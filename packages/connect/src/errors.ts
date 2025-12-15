/**
 * Standard error codes for the protocol
 */
export const ErrorCodes = {
	// Standard JSON-RPC errors
	PARSE_ERROR: -32700,
	INVALID_REQUEST: -32600,
	METHOD_NOT_FOUND: -32601,
	INVALID_PARAMS: -32602,
	INTERNAL_ERROR: -32603,

	// Custom 1Sat errors (4000-4999)
	USER_REJECTED: 4001,
	WALLET_LOCKED: 4002,
	WALLET_NOT_CONNECTED: 4003,
	INSUFFICIENT_FUNDS: 4004,
	INVALID_TRANSACTION: 4005,
	POPUP_BLOCKED: 4006,
	POPUP_CLOSED: 4007,
	TIMEOUT: 4008,
	NETWORK_ERROR: 4009,
	ORIGIN_NOT_ALLOWED: 4010,
} as const

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes]

/**
 * Base error class for 1Sat SDK
 */
export class OneSatError extends Error {
	readonly code: ErrorCode
	readonly data?: unknown

	constructor(code: ErrorCode, message: string, data?: unknown) {
		super(message)
		this.name = 'OneSatError'
		this.code = code
		this.data = data
	}

	toJSON() {
		return {
			code: this.code,
			message: this.message,
			data: this.data,
		}
	}
}

export class UserRejectedError extends OneSatError {
	constructor(message = 'User rejected the request') {
		super(ErrorCodes.USER_REJECTED, message)
		this.name = 'UserRejectedError'
	}
}

export class WalletLockedError extends OneSatError {
	constructor(message = 'Wallet is locked') {
		super(ErrorCodes.WALLET_LOCKED, message)
		this.name = 'WalletLockedError'
	}
}

export class WalletNotConnectedError extends OneSatError {
	constructor(message = 'Wallet is not connected') {
		super(ErrorCodes.WALLET_NOT_CONNECTED, message)
		this.name = 'WalletNotConnectedError'
	}
}

export class InsufficientFundsError extends OneSatError {
	constructor(message = 'Insufficient funds') {
		super(ErrorCodes.INSUFFICIENT_FUNDS, message)
		this.name = 'InsufficientFundsError'
	}
}

export class PopupBlockedError extends OneSatError {
	constructor(message = 'Popup was blocked by the browser') {
		super(ErrorCodes.POPUP_BLOCKED, message)
		this.name = 'PopupBlockedError'
	}
}

export class PopupClosedError extends OneSatError {
	constructor(message = 'Popup was closed before completing the request') {
		super(ErrorCodes.POPUP_CLOSED, message)
		this.name = 'PopupClosedError'
	}
}

export class TimeoutError extends OneSatError {
	constructor(message = 'Request timed out') {
		super(ErrorCodes.TIMEOUT, message)
		this.name = 'TimeoutError'
	}
}

/**
 * Create an error from an error response
 */
export function fromErrorResponse(error: {
	code: number
	message: string
	data?: unknown
}): OneSatError {
	switch (error.code) {
		case ErrorCodes.USER_REJECTED:
			return new UserRejectedError(error.message)
		case ErrorCodes.WALLET_LOCKED:
			return new WalletLockedError(error.message)
		case ErrorCodes.WALLET_NOT_CONNECTED:
			return new WalletNotConnectedError(error.message)
		case ErrorCodes.INSUFFICIENT_FUNDS:
			return new InsufficientFundsError(error.message)
		case ErrorCodes.POPUP_BLOCKED:
			return new PopupBlockedError(error.message)
		case ErrorCodes.POPUP_CLOSED:
			return new PopupClosedError(error.message)
		case ErrorCodes.TIMEOUT:
			return new TimeoutError(error.message)
		default:
			return new OneSatError(error.code as ErrorCode, error.message, error.data)
	}
}
