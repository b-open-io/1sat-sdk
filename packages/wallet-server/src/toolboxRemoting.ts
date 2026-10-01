import { createRequire } from 'node:module'
import type { StorageProvider, TableProvenTx, sdk } from '@bsv/wallet-toolbox'

/**
 * wallet-toolbox StorageServer's own transport helpers, so this server encodes,
 * decodes and validates exactly as the toolbox server does. They are not
 * re-exported from the toolbox entry points; its exports map serves
 * ./out/src/* to require() only.
 */
const toolboxRequire = createRequire(import.meta.url)
const remoting = '@bsv/wallet-toolbox/out/src/storage/remoting'

const binaryJson = toolboxRequire(`${remoting}/BinaryJson`) as {
	BINARY_ENCODING: string
	BINARY_ENCODING_HEADER: string
	BINARY_REQUEST_ENCODING_HEADER: string
	stringifyJsonRpc: (value: unknown, binary: boolean) => string
	decodeBinaryJsonValue: (value: unknown) => unknown
}

export const {
	BINARY_ENCODING,
	BINARY_ENCODING_HEADER,
	BINARY_REQUEST_ENCODING_HEADER,
	stringifyJsonRpc,
	decodeBinaryJsonValue,
} = binaryJson

/** Byte fields of a sync chunk as Uint8Array, so binary responses carry them as base64. */
export const { syncChunkBinary } = toolboxRequire(
	`${remoting}/syncChunkBinary`,
) as {
	syncChunkBinary: (chunk: sdk.SyncChunk) => Record<string, unknown>
}

export const { validateSyncChunkEntities } = toolboxRequire(
	`${remoting}/entityValidationHelpers`,
) as { validateSyncChunkEntities: (chunk: sdk.SyncChunk) => sdk.SyncChunk }

export const { validateSyncProofs } = toolboxRequire(
	`${remoting}/validateRpcSyncProofs`,
) as {
	validateSyncProofs: (
		storage: StorageProvider,
		candidates: TableProvenTx[],
	) => Promise<void>
}
