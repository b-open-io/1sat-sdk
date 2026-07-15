/**
 * Pure helpers for OrdFS multi-tx stream inscription.
 */

/**
 * Split content into consecutive body chunks of at most `chunkSize` bytes.
 * Empty content yields a single empty chunk (one origin inscription).
 */
export function splitStreamChunks(
	content: Uint8Array,
	chunkSize: number,
): Uint8Array[] {
	if (chunkSize < 1) {
		throw new Error('chunkSize must be >= 1')
	}
	if (content.length === 0) {
		return [new Uint8Array(0)]
	}
	const chunks: Uint8Array[] = []
	for (let i = 0; i < content.length; i += chunkSize) {
		chunks.push(content.subarray(i, i + chunkSize))
	}
	return chunks
}

/**
 * Explicit stream opt-in: `stream: true` and/or a positive `streamChunkSize`.
 * Never auto-streams from content size alone.
 */
export function wantsStreamInscription(opts: {
	stream?: boolean
	streamChunkSize?: number
}): boolean {
	if (opts.stream === true) return true
	if (opts.streamChunkSize !== undefined) return true
	return false
}
