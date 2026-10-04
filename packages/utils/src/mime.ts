/**
 * MIME entity framing (RFC 2045 / RFC 5322) for BRC-169 envelope content:
 * a header block, CRLF CRLF, then the body. `Content-Type` is required in a
 * header block, unknown headers are ignored, and content with no header
 * block is `text/plain` (BRC-169 §7.2 item 1).
 */

import { Utils } from '@bsv/sdk'

/** BRC-232 content type: a DAG-CBOR transaction-delivery body. */
export const TRANSACTION_CBOR_CONTENT_TYPE =
	'application/vnd.metanet.transaction+cbor'

export interface MimeEntity {
	/** The `Content-Type` value as written (parameters included) */
	contentType: string
	/** Header fields, names lowercased; empty when there was no header block */
	headers: Record<string, string>
	body: Uint8Array
}

const CRLFCRLF = [13, 10, 13, 10]
const HEADER_LINE = /^([!-9;-~]+):[ \t]*(.*)$/

/** Encode `Content-Type: <contentType>` CRLF CRLF `<body>`. */
export function encodeMimeEntity(
	contentType: string,
	body: Uint8Array | number[],
): Uint8Array {
	const head = Utils.toArray(`Content-Type: ${contentType}\r\n\r\n`, 'utf8')
	const out = new Uint8Array(head.length + body.length)
	out.set(head, 0)
	out.set(body, head.length)
	return out
}

function indexOfCrlfCrlf(bytes: Uint8Array): number {
	for (let i = 0; i + 3 < bytes.length; i++) {
		if (
			bytes[i] === CRLFCRLF[0] &&
			bytes[i + 1] === CRLFCRLF[1] &&
			bytes[i + 2] === CRLFCRLF[2] &&
			bytes[i + 3] === CRLFCRLF[3]
		) {
			return i
		}
	}
	return -1
}

function parseHeaderBlock(text: string): Record<string, string> | undefined {
	const headers: Record<string, string> = {}
	let last: string | undefined
	for (const line of text.split('\r\n')) {
		if ((line.startsWith(' ') || line.startsWith('\t')) && last) {
			// RFC 5322 folding: a continuation of the previous field.
			headers[last] = `${headers[last]} ${line.trim()}`
			continue
		}
		const m = HEADER_LINE.exec(line)
		if (!m) return undefined
		last = m[1].toLowerCase()
		headers[last] = m[2].trim()
	}
	return headers
}

/**
 * Parse a MIME entity. Content with no header block is `text/plain` with the
 * whole input as body.
 *
 * @throws when a header block is present without `Content-Type`
 */
export function parseMimeEntity(bytes: Uint8Array | number[]): MimeEntity {
	const b = Uint8Array.from(bytes)
	const end = indexOfCrlfCrlf(b)
	const headers =
		end < 0
			? undefined
			: parseHeaderBlock(Utils.toUTF8(Array.from(b.subarray(0, end))))
	if (!headers) {
		return { contentType: 'text/plain', headers: {}, body: b }
	}
	const contentType = headers['content-type']
	if (!contentType) {
		throw new Error('MIME entity has no Content-Type')
	}
	return { contentType, headers, body: b.subarray(end + 4) }
}

/** The media type of a `Content-Type` value: lowercased, parameters dropped. */
export function mediaType(contentType: string): string {
	return contentType.split(';')[0].trim().toLowerCase()
}
