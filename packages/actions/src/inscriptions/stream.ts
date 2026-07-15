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
 * Whether inscribe should use an OrdFS stream chain.
 * - Explicit streamChunkSize: stream when content does not fit in one chunk.
 * - Default: stream when content exceeds the single-tx soft cap.
 */
export function shouldStreamInscription(
	contentLength: number,
	opts: {
		streamChunkSize?: number
		maxSingleBytes: number
	},
): boolean {
	if (opts.streamChunkSize !== undefined) {
		return contentLength > opts.streamChunkSize
	}
	return contentLength > opts.maxSingleBytes
}
