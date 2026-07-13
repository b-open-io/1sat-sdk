import { Utils } from '@bsv/sdk'

/**
 * Canonical byte serializations for BRC-104 general (authenticated) HTTP
 * messages. These MUST match the client (`@bsv/sdk` AuthFetch /
 * SimplifiedFetchTransport) byte-for-byte, or signature verification fails.
 *
 * Ported from the BSV `ExpressTransport` server, adapted to the web
 * `Request`/`Response` model: the request body is the raw bytes received (not
 * a parsed-then-restringified form), which is exactly what the client signed.
 */

/** A general HTTP response decoded from a signed message payload. */
export interface DecodedResponse {
	requestId: string
	status: number
	headers: Record<string, string>
	body?: number[]
}

/**
 * Reproduces the signed payload for an incoming general request: request
 * nonce, method, pathname, search, the signed subset of headers (sorted), and
 * the body. `bodyBytes` is the raw request body, or null when there is none.
 */
export function buildRequestPayload(
	request: Request,
	bodyBytes: number[] | null,
): number[] {
	const url = new URL(request.url)
	const writer = new Utils.Writer()

	const requestNonce = request.headers.get('x-bsv-auth-request-id')
	writer.write(requestNonce ? Utils.toArray(requestNonce, 'base64') : [])

	writer.writeVarIntNum(request.method.length)
	writer.write(Utils.toArray(request.method))

	if (url.pathname.length > 0) {
		const pathname = Utils.toArray(url.pathname)
		writer.writeVarIntNum(pathname.length)
		writer.write(pathname)
	} else {
		writer.writeVarIntNum(-1)
	}

	if (url.search.length > 0) {
		const search = Utils.toArray(url.search)
		writer.writeVarIntNum(search.length)
		writer.write(search)
	} else {
		writer.writeVarIntNum(-1)
	}

	writeSignedHeaders(writer, request.headers)
	writeBody(writer, bodyBytes)
	return writer.toArray()
}

/**
 * Builds the payload the server signs for a general response: request id,
 * status, the signed subset of response headers (sorted), and the body.
 */
export function buildResponsePayload(
	requestId: string,
	status: number,
	headers: Record<string, string>,
	body: number[],
): number[] {
	const writer = new Utils.Writer()
	writer.write(Utils.toArray(requestId, 'base64'))
	writer.writeVarIntNum(status)

	const included: Array<[string, string]> = []
	for (const [k, v] of Object.entries(headers)) {
		const key = k.toLowerCase()
		if (
			(key.startsWith('x-bsv-') || key === 'authorization') &&
			!key.startsWith('x-bsv-auth')
		) {
			included.push([key, v])
		}
	}
	included.sort(([a], [b]) => a.localeCompare(b))

	writer.writeVarIntNum(included.length)
	for (const [key, value] of included) {
		const keyBytes = Utils.toArray(key, 'utf8')
		writer.writeVarIntNum(keyBytes.length)
		writer.write(keyBytes)
		const valueBytes = Utils.toArray(value, 'utf8')
		writer.writeVarIntNum(valueBytes.length)
		writer.write(valueBytes)
	}

	// Response bodies always carry a real length prefix (0 when empty) — unlike
	// request bodies, which use the -1 "absent" sentinel.
	writer.writeVarIntNum(body.length)
	if (body.length > 0) writer.write(body)
	return writer.toArray()
}

/** Decodes a signed general-response payload back into an HTTP response. */
export function decodeResponse(payload: number[]): DecodedResponse {
	const reader = new Utils.Reader(payload)
	const requestId = Utils.toBase64(reader.read(32))
	const status = reader.readVarIntNum()

	const headers: Record<string, string> = {}
	const nHeaders = reader.readVarIntNum()
	for (let i = 0; i < nHeaders; i++) {
		const keyLen = reader.readVarIntNum()
		const key = Utils.toUTF8(reader.read(keyLen))
		const valueLen = reader.readVarIntNum()
		headers[key] = Utils.toUTF8(reader.read(valueLen))
	}

	let body: number[] | undefined
	const bodyLen = reader.readVarIntNum()
	if (bodyLen > 0) body = reader.read(bodyLen)

	return { requestId, status, headers, body }
}

/** The request id (base64 of the first 32 payload bytes) of a general message. */
export function requestIdOf(payload: number[]): string {
	return Utils.toBase64(new Utils.Reader(payload).read(32))
}

function writeSignedHeaders(writer: Utils.Writer, headers: Headers): void {
	const included: Array<[string, string]> = []
	for (const [k, v] of headers.entries()) {
		const key = k.toLowerCase()
		const value = key === 'content-type' ? v.split(';')[0].trim() : v
		if (
			(key.startsWith('x-bsv-') ||
				key === 'content-type' ||
				key === 'authorization') &&
			!key.startsWith('x-bsv-auth')
		) {
			included.push([key, value])
		}
	}
	included.sort(([a], [b]) => a.localeCompare(b))

	writer.writeVarIntNum(included.length)
	for (const [key, value] of included) {
		const keyBytes = Utils.toArray(key, 'utf8')
		writer.writeVarIntNum(keyBytes.length)
		writer.write(keyBytes)
		const valueBytes = Utils.toArray(value, 'utf8')
		writer.writeVarIntNum(valueBytes.length)
		writer.write(valueBytes)
	}
}

/** A present body writes its length then bytes; an absent body writes -1. */
function writeBody(writer: Utils.Writer, bodyBytes: number[] | null): void {
	if (bodyBytes && bodyBytes.length > 0) {
		writer.writeVarIntNum(bodyBytes.length)
		writer.write(bodyBytes)
	} else {
		writer.writeVarIntNum(-1)
	}
}
