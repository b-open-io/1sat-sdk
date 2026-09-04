/**
 * Cosigner-validated BSV21 transfer actions.
 *
 * Two-request flow used by a cosigner backend:
 *   1. {@link prepareCosignBsv21Transfer} — backend builds tx, returns sighashes
 *   2. {@link finalizeCosignBsv21Transfer} — backend assembles full unlocks and broadcasts
 *
 * The {@link CosignSessionStore} interface lets the backend supply persistent
 * session storage (e.g. Postgres). {@link InMemoryCosignSessionStore} is the
 * default for tests + ephemeral demo usage.
 */

export {
	COSIGN_DEFAULT_SIGHASH,
	COSIGN_PROTOCOL_ID,
	type CosignOwnerSig,
	type CosignRecipientPayload,
	type CosignSessionDestinationMeta,
	type CosignSessionInputMeta,
	type CosignSessionStore,
	type CosignTokenInput,
	type CosignTransferBurn,
	type CosignTransferDestination,
	type CosignTransferSession,
	type FinalizeCosignBsv21TransferInput,
	type FinalizeCosignBsv21TransferResult,
	InMemoryCosignSessionStore,
	type PrepareCosignBsv21TransferInput,
	type PrepareCosignBsv21TransferResult,
} from './types.js'
export { prepareCosignBsv21Transfer } from './prepare.js'
export { finalizeCosignBsv21Transfer } from './finalize.js'
export {
	buildCosignDestination,
	type BuildCosignDestinationInput,
	type BuildCosignDestinationResult,
} from './buildDestination.js'
