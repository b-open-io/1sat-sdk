/**
 * Inscriptions Module
 *
 * Actions for creating inscriptions, including multi-tx OrdFS streams.
 */

import type { Destination } from '@1sat/types'
import { P1SAT_PROTOCOL } from '@1sat/types'
import { Beef, Hash, type Script, Utils } from '@bsv/sdk'
import { prepareP1SatArgs } from '../apply'
import {
	DEFAULT_STREAM_CHUNK_SIZE,
	MAX_INSCRIPTION_BYTES,
	ORDFS_STREAM_CONTENT_TYPE,
	ORDFS_STREAM_PARAM,
	ORDINALS_BASKET,
} from '../constants'
import { appendSigmaPlaceholder } from '../signing/sigma'
import type { Action, ActionOptions, OneSatContext } from '../types'
import { executeTrackedAction } from '../utils/createTrackedAction'
import { buildInscriptionScript } from '../utils/inscriptionScript'
import { buildOrdinalCustomInstructions } from '../utils/ordinalRemittance'
import {
	type ResolvedDestination,
	resolveDestination,
} from '../utils/resolveDestination'
import { splitStreamChunks, wantsStreamInscription } from './stream'

// ============================================================================
// Types
// ============================================================================

export interface InscribeRequest extends ActionOptions {
	/** Base64 encoded content */
	base64Content: string
	/** Content type (MIME type) */
	contentType: string
	/** Optional MAP metadata */
	map?: Record<string, string>
	/** Sign with BAP identity (Sigma protocol) */
	signWithBAP?: boolean
	/** Where to lock the inscription output. Defaults to self. */
	destination?: Destination
	/**
	 * Opt into OrdFS multi-tx streaming with the default chunk size
	 * ({@link DEFAULT_STREAM_CHUNK_SIZE}, 1 MiB). Prefer this for large files.
	 */
	stream?: boolean
	/**
	 * Opt into OrdFS streaming with this body size (bytes) per chunk.
	 * Implies streaming even if `stream` is omitted. Overrides the default
	 * chunk size when `stream` is also true.
	 */
	streamChunkSize?: number
}

export interface InscribeResponse {
	/** Origin txid (first chunk for streams, the inscription txid otherwise) */
	txid?: string
	/** Atomic BEEF for the result (combined for streams when available) */
	tx?: number[]
	/** All txids in a stream chain (streaming only) */
	txids?: string[]
	/** True when content was written as an OrdFS multi-tx stream */
	streamed?: boolean
	/**
	 * SHA-256 hex of the full content body. Also stamped as `sha256:<hash>` on
	 * the inscription output (single-shot and stream). Not carried on spends.
	 */
	contentHash?: string
	/**
	 * When a stream fails after one or more noSend txs were created, the
	 * origin/chunk txids completed so far (not broadcast as a batch).
	 */
	partialTxids?: string[]
	error?: string
}

// ============================================================================
// Internal helpers
// ============================================================================

async function inscribeWithSigma(
	ctx: OneSatContext,
	lockingScript: Script,
	tags: string[],
	input: InscribeRequest,
	outputCustomInstructions?: string,
	outputKeyIDForLog?: string,
): Promise<InscribeResponse> {
	// Full script with the SIGMA signature zeroed, so the output is already
	// its on-chain size; apply creates the anchor and swaps the signature in.
	const placeholderScript = await appendSigmaPlaceholder(ctx, lockingScript)
	const args = await prepareP1SatArgs(ctx, {
		description: 'Create inscription',
		outputs: [
			{
				lockingScript: placeholderScript.toHex(),
				satoshis: 1,
				outputDescription: 'Inscription',
				basket: ORDINALS_BASKET,
				tags,
				customInstructions: outputCustomInstructions,
			},
		],
		options: {
			randomizeOutputs: false,
			acceptDelayedBroadcast: true,
		},
	})

	const result = await executeTrackedAction(
		ctx.wallet,
		args,
		input.fundingProvider,
		undefined,
		undefined,
		{
			spends: [],
			usePermissionModule:
				input.usePermissionModule ?? input.useOneSatModule ?? input.useModule,
			permissionScheme: '1sat',
		},
	)

	if (ctx.debug && ctx.log) {
		ctx.log({
			timestamp: new Date().toISOString(),
			action: 'inscribe',
			input: {
				contentType: input.contentType,
				map: input.map,
				signWithBAP: true,
				anchorOutpoint: args.inputs?.[0]?.outpoint,
			},
			txid: result.txid,
			rawtx: result.tx ? Utils.toHex(result.tx) : undefined,
			outputs: [
				{
					index: 0,
					protocolID: P1SAT_PROTOCOL,
					keyID: outputKeyIDForLog,
					basket: ORDINALS_BASKET,
					satoshis: 1,
				},
			],
		})
	}

	return result
}

/**
 * Inscribe content as an OrdFS stream: origin chunk with `stream=ordfs` on the
 * content type, then spends of that 1-sat output with `ordfs/stream` bodies.
 * All steps use noSend until the final chunk, which sendWiths the batch.
 */
async function inscribeStream(
	ctx: OneSatContext,
	input: InscribeRequest,
	content: Uint8Array,
	chunkSize: number,
	resolved: ResolvedDestination,
	customInstructions: string | undefined,
): Promise<InscribeResponse> {
	const destKeyID = resolved.customInstructions?.keyID
	const destCounterparty =
		(resolved.customInstructions?.counterparty as string | undefined) ?? 'self'
	if (!destKeyID) {
		// Stream chunks spend the prior inscription via wallet-derived P2PKH.
		return { error: 'streaming-requires-derived-destination' }
	}

	const chunks = splitStreamChunks(content, chunkSize)
	const totalChunks = chunks.length
	const txids: string[] = []
	const allNoSendChange: string[] = []
	let accumulatedBEEF: number[] | undefined

	const contentHash = Utils.toHex(Hash.sha256(Array.from(content)))
	const shaTag = `sha256:${contentHash}`

	const fail = (error: string): InscribeResponse => ({
		error,
		contentHash,
		partialTxids: txids.length > 0 ? [...txids] : undefined,
		// Incomplete chains stay noSend — not batch-broadcast.
		streamed: true,
	})

	const originContentType = `${input.contentType}; ${ORDFS_STREAM_PARAM}`
	const streamTags = (index: number, extra: string[] = []) => [
		...extra,
		shaTag,
		`stream-i:${index}`,
	]

	// One chunk: normal broadcast with stream origin content-type (no noSend chain).
	if (totalChunks === 1) {
		const originScript = buildInscriptionScript(
			resolved.lockingScript,
			chunks[0],
			originContentType,
			input.map,
		)
		const originTags = streamTags(0, [
			`type:${input.contentType.split(';')[0]?.trim() || input.contentType}`,
			'origin',
		])
		try {
			const result = await executeTrackedAction(ctx.wallet, {
				description: 'Stream origin inscription',
				outputs: [
					{
						lockingScript: originScript.toHex(),
						satoshis: 1,
						outputDescription: 'Stream origin',
						basket: ORDINALS_BASKET,
						tags: originTags,
						customInstructions,
					},
				],
				options: {
					acceptDelayedBroadcast: false,
					randomizeOutputs: false,
				},
			})
			if (!result.txid) {
				return { error: 'origin-no-txid', streamed: true, contentHash }
			}
			return {
				txid: result.txid,
				tx: result.tx,
				txids: [result.txid],
				streamed: true,
				contentHash,
			}
		} catch (e) {
			return {
				error: e instanceof Error ? e.message : 'stream-origin-failed',
				streamed: true,
				contentHash,
			}
		}
	}

	// --- Multi-chunk: noSend until the last spend, then sendWith prior txids ---
	const originScript = buildInscriptionScript(
		resolved.lockingScript,
		chunks[0],
		originContentType,
		input.map,
	)

	const multiOriginTags = streamTags(0, [
		`type:${input.contentType.split(';')[0]?.trim() || input.contentType}`,
		'origin',
	])

	let originResult: Awaited<ReturnType<typeof executeTrackedAction>>
	try {
		originResult = await executeTrackedAction(ctx.wallet, {
			description: 'Stream origin inscription',
			outputs: [
				{
					lockingScript: originScript.toHex(),
					satoshis: 1,
					outputDescription: 'Stream origin',
					basket: ORDINALS_BASKET,
					tags: multiOriginTags,
					customInstructions,
				},
			],
			options: {
				acceptDelayedBroadcast: true,
				randomizeOutputs: false,
				noSend: true,
			},
		})
	} catch (e) {
		return fail(e instanceof Error ? e.message : 'stream-origin-failed')
	}

	if (!originResult.txid) {
		return fail('origin-no-txid')
	}
	txids.push(originResult.txid)
	let priorSpendId = `${originResult.actionId}_0`
	allNoSendChange.push(...(originResult.noSendChange ?? []))
	if (originResult.tx) {
		const beef = new Beef()
		beef.mergeBeef(Beef.fromBinary(originResult.tx))
		accumulatedBEEF = Array.from(beef.toBinary())
	}

	for (let i = 1; i < totalChunks; i++) {
		const isLast = i === totalChunks - 1
		const chunkScript = buildInscriptionScript(
			resolved.lockingScript,
			chunks[i],
			ORDFS_STREAM_CONTENT_TYPE,
		)
		const priorTxid = txids[i - 1]

		let result: Awaited<ReturnType<typeof executeTrackedAction>>
		try {
			result = await executeTrackedAction(
				ctx.wallet,
				{
					description: `Stream chunk ${i}/${totalChunks - 1}`,
					inputBEEF: accumulatedBEEF,
					inputs: [
						{
							outpoint: `${priorTxid}.0`,
							inputDescription: 'Prior stream chunk',
							unlockingScriptLength: 108,
						},
					],
					outputs: [
						{
							lockingScript: chunkScript.toHex(),
							satoshis: 1,
							outputDescription: `Stream chunk ${i}`,
							basket: ORDINALS_BASKET,
							tags: streamTags(i, [`type:${ORDFS_STREAM_CONTENT_TYPE}`]),
							customInstructions,
						},
					],
					options: {
						randomizeOutputs: false,
						noSend: true,
						noSendChange: allNoSendChange,
						knownTxids: [...txids],
						acceptDelayedBroadcast: true,
						trustSelf: 'known',
						// This action is broadcast together with prior noSend txids.
						...(isLast ? { sendWith: [...txids] } : {}),
					},
				},
				undefined,
				accumulatedBEEF,
				undefined,
				{
					// Wallet-held prior chunk: basket+id (not BEEF outpoint)
					spends: [{ basket: ORDINALS_BASKET, id: priorSpendId }],
				},
			)
		} catch (e) {
			return fail(e instanceof Error ? e.message : `stream-chunk-${i}-failed`)
		}

		if (!result.txid) {
			return fail(`chunk-${i}-no-txid`)
		}
		txids.push(result.txid)
		priorSpendId = `${result.actionId}_0`
		allNoSendChange.push(...(result.noSendChange ?? []))
		if (result.tx && accumulatedBEEF) {
			const beef = Beef.fromBinary(accumulatedBEEF)
			beef.mergeBeef(Beef.fromBinary(result.tx))
			accumulatedBEEF = Array.from(beef.toBinary())
		} else if (result.tx) {
			accumulatedBEEF = Array.from(result.tx)
		}
	}

	if (ctx.debug && ctx.log) {
		ctx.log({
			timestamp: new Date().toISOString(),
			action: 'inscribe',
			input: {
				contentType: input.contentType,
				map: input.map,
				streamChunkSize: chunkSize,
				totalChunks,
			},
			txid: txids[0],
			outputs: [
				{
					index: 0,
					protocolID: P1SAT_PROTOCOL,
					keyID: destKeyID,
					basket: ORDINALS_BASKET,
					satoshis: 1,
				},
			],
		})
	}

	return {
		txid: txids[0],
		tx: accumulatedBEEF,
		txids,
		streamed: true,
		contentHash,
	}
}

// ============================================================================
// Actions
// ============================================================================

/**
 * Create an inscription.
 *
 * Single-tx by default (up to {@link MAX_INSCRIPTION_BYTES}). For larger
 * content or multi-tx OrdFS streams, pass `stream: true` (1 MiB chunks) or
 * `streamChunkSize`.
 */
export const inscribe: Action<InscribeRequest, InscribeResponse> = {
	meta: {
		name: 'inscribe',
		description:
			'Create a new inscription (single tx, or OrdFS multi-tx stream when stream/streamChunkSize is set)',
		category: 'inscriptions',
		inputSchema: {
			type: 'object',
			properties: {
				base64Content: {
					type: 'string',
					description: 'Base64 encoded content',
				},
				contentType: {
					type: 'string',
					description: 'Content type (MIME type)',
				},
				map: {
					type: 'object',
					description: 'Optional MAP metadata',
					properties: {},
				},
				signWithBAP: {
					type: 'boolean',
					description: 'Sign with BAP identity (Sigma protocol)',
				},
				destination: {
					type: 'object',
					description:
						'Where to lock the inscription output. One of lockingScript (hex), counterparty (pubkey), or address. Defaults to self. Streams require a wallet-derived destination (not a bare address).',
				},
				stream: {
					type: 'boolean',
					description:
						'Opt into OrdFS multi-tx streaming with the default 1 MiB chunk size',
				},
				streamChunkSize: {
					type: 'integer',
					description:
						'Opt into OrdFS streaming with this chunk body size in bytes (implies stream)',
				},
			},
			required: ['base64Content', 'contentType'],
		},
	},
	async execute(ctx, input) {
		try {
			const content = new Uint8Array(
				Utils.toArray(input.base64Content, 'base64'),
			)
			const contentHash = Utils.toHex(Hash.sha256(Array.from(content)))
			const shaTag = `sha256:${contentHash}`

			if (
				input.streamChunkSize !== undefined &&
				(!Number.isFinite(input.streamChunkSize) || input.streamChunkSize < 1)
			) {
				return { error: 'invalid-stream-chunk-size' }
			}

			const wantsStream = wantsStreamInscription({
				stream: input.stream,
				streamChunkSize: input.streamChunkSize,
			})

			if (!wantsStream && content.length > MAX_INSCRIPTION_BYTES) {
				return {
					error: `Inscription data too large: ${content.length} bytes (max ${MAX_INSCRIPTION_BYTES} without streaming). Pass stream: true (1 MiB chunks) or streamChunkSize.`,
				}
			}

			if (wantsStream && input.signWithBAP) {
				return { error: 'streaming-with-sigma-not-supported' }
			}
			if (wantsStream && input.fundingProvider) {
				return { error: 'streaming-with-funding-provider-not-supported' }
			}

			const resolved = await resolveDestination(ctx, input.destination, {
				protocolID: P1SAT_PROTOCOL,
				keyIDPrefix: 'inscribe',
			})

			const typeBase =
				input.contentType.split(';')[0]?.trim() || input.contentType
			const tags = [`type:${typeBase}`, 'origin', shaTag]

			const customInstructions = resolved.customInstructions
				? buildOrdinalCustomInstructions({
						protocolID: resolved.customInstructions.protocolID,
						keyID: resolved.customInstructions.keyID,
						counterparty: resolved.customInstructions.counterparty as
							| string
							| undefined,
						tags,
						name: input.map?.name,
					})
				: undefined

			if (wantsStream) {
				const effectiveChunkSize =
					input.streamChunkSize ?? DEFAULT_STREAM_CHUNK_SIZE
				return await inscribeStream(
					ctx,
					input,
					content,
					effectiveChunkSize,
					resolved,
					customInstructions,
				)
			}

			const lockingScript = buildInscriptionScript(
				resolved.lockingScript,
				content,
				input.contentType,
				input.map,
			)

			if (input.signWithBAP) {
				const sigmaResult = await inscribeWithSigma(
					ctx,
					lockingScript,
					tags,
					input,
					customInstructions,
					resolved.customInstructions?.keyID,
				)
				return { ...sigmaResult, contentHash }
			}

			const args = await prepareP1SatArgs(ctx, {
				description: 'Create inscription',
				outputs: [
					{
						lockingScript: lockingScript.toHex(),
						satoshis: 1,
						outputDescription: 'Inscription',
						basket: ORDINALS_BASKET,
						tags,
						customInstructions,
					},
				],
				options: {
					acceptDelayedBroadcast: false,
					randomizeOutputs: false,
				},
			})
			const result = await executeTrackedAction(
				ctx.wallet,
				args,
				input.fundingProvider,
				undefined,
				undefined,
				{
					spends: [],
					usePermissionModule:
						input.usePermissionModule ??
						input.useOneSatModule ??
						input.useModule,
					permissionScheme: '1sat',
				},
			)

			if (!result.txid) {
				return { error: 'no-txid-returned', contentHash }
			}

			if (ctx.debug && ctx.log) {
				ctx.log({
					timestamp: new Date().toISOString(),
					action: 'inscribe',
					input: {
						contentType: input.contentType,
						map: input.map,
						destination: input.destination,
					},
					txid: result.txid,
					rawtx: result.tx ? Utils.toHex(result.tx) : undefined,
					outputs: [
						{
							index: 0,
							protocolID: P1SAT_PROTOCOL,
							keyID: resolved.customInstructions?.keyID,
							basket: ORDINALS_BASKET,
							satoshis: 1,
						},
					],
				})
			}

			return {
				txid: result.txid,
				tx: result.tx,
				contentHash,
			}
		} catch (error) {
			console.error('[inscribe]', error)
			if (ctx.debug && ctx.log) {
				ctx.log({
					timestamp: new Date().toISOString(),
					action: 'inscribe',
					input: { contentType: input.contentType, map: input.map },
					error: error instanceof Error ? error.message : 'unknown-error',
				})
			}
			return {
				error: error instanceof Error ? error.message : 'unknown-error',
			}
		}
	},
}

// ============================================================================
// Module exports
// ============================================================================

/** All inscription actions for registry */
export const inscriptionsActions = [inscribe]
