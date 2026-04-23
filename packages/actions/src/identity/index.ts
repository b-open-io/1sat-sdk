/**
 * Identity Module
 *
 * BAP identity actions using the wallet's identity-{N} key derivation scheme.
 *
 * Key hierarchy (per BAP spec):
 *   identity-0 = root key (BAP ID source, signs initial ID and can destroy identity)
 *   identity-1 = first signing key (declared in seq:1 ID record)
 *   identity-{N} = signing key declared in seq:N ID record
 *
 * Rotation chain:
 *   Seq 1: identity-0 signs, declares identity-1 as current signing key
 *   Seq 2: identity-1 signs, declares identity-2 as current signing key
 *   Seq N: identity-(N-1) signs, declares identity-N as current signing key
 *
 * All keys derived at protocolID=[1,"sigma"], keyID="identity-{N}".
 */

import { BAP, BitCom } from '@1sat/templates'
import { Hash, OP, PublicKey, Script, Utils } from '@bsv/sdk'
import {
	BAP_BASKET,
	BAP_BITCOM_ADDRESS,
	BAP_KEY_ID,
	BAP_PROTOCOL_ID,
} from '../constants'
import { applyBapAip, resolveCurrentKeyId } from '../signing/aip'
import type { Action, ActionOptions, OneSatContext } from '../types'
import { executeTrackedAction } from '../utils/createTrackedAction'
import { pickNewestAlias } from './pickNewestAlias'

const { toArray, toBase58, toHex } = Utils

// ============================================================================
// Key ID Helpers
// ============================================================================

function signingKeyId(index: number): string {
	return `${BAP_KEY_ID}-${index}`
}

async function deriveAddress(
	ctx: OneSatContext,
	keyID: string,
): Promise<string> {
	const { publicKey } = await ctx.wallet.getPublicKey({
		protocolID: BAP_PROTOCOL_ID,
		keyID,
		counterparty: 'self',
	})
	return PublicKey.fromString(publicKey).toAddress()
}

// ============================================================================
// BAP ID Resolution
// ============================================================================

/**
 * Compute the BAP ID deterministically from the wallet's identity-0 key.
 *
 * BAP ID = base58(ripemd160(sha256(identity-0.address)))
 *
 * This always returns a value — every wallet can derive identity-0.
 */
export async function computeBapId(ctx: OneSatContext): Promise<string> {
	const address = await deriveAddress(ctx, signingKeyId(0))
	return toBase58(Hash.ripemd160(toHex(Hash.sha256(address, 'utf8')), 'hex'))
}

/**
 * Resolve the BAP ID if the identity has been published.
 *
 * Returns the BAP ID if a `type:id` output exists in the BAP basket,
 * null if the identity hasn't been published yet.
 */
export async function resolveBapId(ctx: OneSatContext): Promise<string | null> {
	const result = await ctx.wallet.listOutputs({
		basket: BAP_BASKET,
		tags: ['type:id'],
		limit: 1,
	})
	if (!result.outputs.length) return null
	return computeBapId(ctx)
}

/**
 * Find the current sequence number from BAP basket ID outputs.
 * Returns the highest seq tag value, or null if no ID outputs exist.
 */
async function getCurrentSequence(ctx: OneSatContext): Promise<number | null> {
	const result = await ctx.wallet.listOutputs({
		basket: BAP_BASKET,
		tags: ['type:id'],
		includeTags: true,
		limit: 100,
	})

	if (!result.outputs.length) return null

	let maxSeq = 0
	for (const output of result.outputs) {
		const seqTag = output.tags?.find((t) => t.startsWith('seq:'))
		if (!seqTag) continue
		const seq = Number.parseInt(seqTag.slice(4), 10)
		if (seq > maxSeq) maxSeq = seq
	}

	return maxSeq
}

// ============================================================================
// ID Output Builder Helper
// ============================================================================

interface IdOutputParams {
	seq: number
	signerKeyId: string
	declareKeyId: string
}

async function buildIdOutput(
	ctx: OneSatContext,
	bapId: string,
	params: IdOutputParams,
): Promise<{
	lockingScript: string
	tags: string[]
	customInstructions: string
}> {
	const declareAddress = await deriveAddress(ctx, params.declareKeyId)

	const script = new Script()
	script.writeOpCode(OP.OP_FALSE)
	script.writeOpCode(OP.OP_RETURN)
	script.writeBin(toArray(BAP_BITCOM_ADDRESS))
	script.writeBin(toArray('ID'))
	script.writeBin(toArray(bapId))
	script.writeBin(toArray(declareAddress))

	const signedScript = await applyBapAip(ctx, script, params.signerKeyId)

	return {
		lockingScript: signedScript.toHex(),
		tags: ['type:id', `bapId:${bapId}`, `seq:${params.seq}`],
		customInstructions: JSON.stringify({
			protocolID: BAP_PROTOCOL_ID,
			keyID: params.declareKeyId,
		}),
	}
}

// ============================================================================
// Types
// ============================================================================

export interface AttestRequest extends ActionOptions {
	/** SHA-256 hash of the attestation URN (urn:bap:id:attribute:value:nonce) */
	attestationHash: string
	/** Attestation sequence number (default "0") */
	counter?: string
}

export interface UpdateProfileRequest extends ActionOptions {
	/** Schema.org profile data (e.g. { "@type": "Person", "name": "Alice" }) */
	profile: Record<string, unknown>
}

export interface IdentityResponse {
	txid?: string
	tx?: number[]
	bapId?: string
	error?: string
}

export interface ProfileResponse {
	bapId?: string
	profile?: Record<string, unknown>
	error?: string
}

// ============================================================================
// Actions
// ============================================================================

/**
 * Publish the initial BAP ID record.
 *
 * Derives identity-0 (root key), computes the BAP ID, and publishes
 * the ID record signed by identity-0 via AIP. The ID record declares
 * identity-1 as the current signing key. The output lands in the `bap`
 * basket tagged with seq:1.
 *
 * Returns an error if an identity has already been published.
 */
export const publishIdentity: Action<ActionOptions, IdentityResponse> = {
	meta: {
		name: 'publishIdentity',
		description: 'Publish initial BAP identity record from wallet',
		category: 'identity',
		inputSchema: {
			type: 'object',
			properties: {},
		},
	},
	async execute(ctx, input) {
		try {
			const existing = await ctx.wallet.listOutputs({
				basket: BAP_BASKET,
				tags: ['type:id'],
				limit: 1,
			})
			if (existing.outputs.length) {
				return { error: 'identity-exists: already published' }
			}

			const bapId = await computeBapId(ctx)
			const rootKeyId = signingKeyId(0)
			const firstSigningKeyId = signingKeyId(1)

			const idOutput = await buildIdOutput(ctx, bapId, {
				seq: 1,
				signerKeyId: rootKeyId,
				declareKeyId: firstSigningKeyId,
			})

			const result = await executeTrackedAction(
				ctx.wallet,
				{
					description: 'BAP identity publication',
					outputs: [
						{
							lockingScript: idOutput.lockingScript,
							satoshis: 0,
							outputDescription: 'BAP ID',
							basket: BAP_BASKET,
							tags: idOutput.tags,
							customInstructions: idOutput.customInstructions,
						},
					],
					options: {
						acceptDelayedBroadcast: false,
						randomizeOutputs: false,
					},
				},
				input?.fundingProvider,
			)

			if (!result.txid) return { error: 'no-txid-returned' }

			return {
				txid: result.txid,
				tx: result.tx,
				bapId,
			}
		} catch (error) {
			console.error('[publishIdentity]', error)
			return {
				error: error instanceof Error ? error.message : 'unknown-error',
			}
		}
	},
}

/**
 * Rotate the BAP signing key.
 *
 * Finds the current signing key (highest sequence), derives the next
 * key (identity-{N+1}), builds a new BAP ID record declaring the new
 * currentAddress, signs it with the outgoing key, and publishes.
 * The previous ID output is relinquished.
 */
export const rotateIdentity: Action<ActionOptions, IdentityResponse> = {
	meta: {
		name: 'rotateIdentity',
		description: 'Rotate BAP signing key to the next derived key',
		category: 'identity',
		inputSchema: {
			type: 'object',
			properties: {},
		},
	},
	async execute(ctx, input) {
		try {
			const currentSeq = await getCurrentSequence(ctx)
			if (currentSeq === null) {
				return { error: 'no-identity: publish identity first' }
			}

			const currentKeyId = await resolveCurrentKeyId(ctx)
			const bapId = await computeBapId(ctx)
			const nextSeq = currentSeq + 1
			const nextKeyId = signingKeyId(nextSeq)

			const idOutput = await buildIdOutput(ctx, bapId, {
				seq: nextSeq,
				signerKeyId: currentKeyId,
				declareKeyId: nextKeyId,
			})

			// Find existing ID outputs to relinquish after rotation
			const existingIds = await ctx.wallet.listOutputs({
				basket: BAP_BASKET,
				tags: ['type:id'],
				limit: 100,
			})

			const result = await executeTrackedAction(
				ctx.wallet,
				{
					description: 'BAP key rotation',
					outputs: [
						{
							lockingScript: idOutput.lockingScript,
							satoshis: 0,
							outputDescription: 'BAP ID',
							basket: BAP_BASKET,
							tags: idOutput.tags,
							customInstructions: idOutput.customInstructions,
						},
					],
					options: {
						acceptDelayedBroadcast: false,
						randomizeOutputs: false,
					},
				},
				input?.fundingProvider,
			)

			if (!result.txid) return { error: 'no-txid-returned' }

			for (const old of existingIds.outputs) {
				await ctx.wallet.relinquishOutput({
					basket: BAP_BASKET,
					output: old.outpoint,
				})
			}

			return {
				txid: result.txid,
				tx: result.tx,
				bapId,
			}
		} catch (error) {
			console.error('[rotateIdentity]', error)
			return {
				error: error instanceof Error ? error.message : 'unknown-error',
			}
		}
	},
}

/**
 * Publish a BAP ATTEST transaction.
 *
 * OP_RETURN: BAP_PREFIX | "ATTEST" | attestation_hash | counter
 * Signed with AIP via the current signing key.
 */
export const attest: Action<AttestRequest, IdentityResponse> = {
	meta: {
		name: 'attest',
		description: 'Publish a BAP attestation signed with BAP identity',
		category: 'identity',
		inputSchema: {
			type: 'object',
			properties: {
				attestationHash: {
					type: 'string',
					description:
						'SHA-256 hash of the attestation URN (urn:bap:id:attribute:value:nonce)',
				},
				counter: {
					type: 'string',
					description: 'Attestation sequence number (default "0")',
				},
			},
			required: ['attestationHash'],
		},
	},
	async execute(ctx, input) {
		try {
			const bapId = await resolveBapId(ctx)
			if (!bapId) {
				return { error: 'no-identity: publish identity first' }
			}

			const script = new Script()
			script.writeOpCode(OP.OP_FALSE)
			script.writeOpCode(OP.OP_RETURN)
			script.writeBin(toArray(BAP_BITCOM_ADDRESS))
			script.writeBin(toArray('ATTEST'))
			script.writeBin(toArray(input.attestationHash))
			script.writeBin(toArray(input.counter ?? '0'))

			const signedScript = await applyBapAip(ctx, script)

			const result = await executeTrackedAction(
				ctx.wallet,
				{
					description: 'BAP attestation',
					outputs: [
						{
							lockingScript: signedScript.toHex(),
							satoshis: 0,
							outputDescription: 'BAP ATTEST',
							basket: BAP_BASKET,
							tags: ['type:attest', `hash:${input.attestationHash}`],
						},
					],
					options: {
						acceptDelayedBroadcast: false,
						randomizeOutputs: false,
					},
				},
				input.fundingProvider,
			)

			if (!result.txid) return { error: 'no-txid-returned' }

			return {
				txid: result.txid,
				tx: result.tx,
			}
		} catch (error) {
			console.error('[attest]', error)
			return {
				error: error instanceof Error ? error.message : 'unknown-error',
			}
		}
	},
}

/**
 * Publish a BAP ALIAS transaction to update the identity's profile.
 *
 * If the identity has not been published yet, this will create both the ID
 * record and the ALIAS in a single transaction (signed by identity-0 and
 * identity-1 respectively). If the identity exists, only the ALIAS is
 * updated (signed by the current signing key).
 *
 * OP_RETURN: BAP_PREFIX | "ALIAS" | bap_id | profile_json
 * Signed with AIP via the current signing key.
 */
export const updateProfile: Action<UpdateProfileRequest, IdentityResponse> = {
	meta: {
		name: 'updateProfile',
		description: 'Update BAP identity profile signed with BAP identity',
		category: 'identity',
		inputSchema: {
			type: 'object',
			properties: {
				profile: {
					type: 'object',
					description:
						'Schema.org profile data (e.g. { "@type": "Person", "name": "Alice" })',
				},
			},
			required: ['profile'],
		},
	},
	async execute(ctx, input) {
		try {
			const publishedAtTag = `publishedAt:${Date.now()}`

			const existingId = await resolveBapId(ctx)
			const bapId = existingId ?? (await computeBapId(ctx))

			const existingAliases = await ctx.wallet.listOutputs({
				basket: BAP_BASKET,
				tags: ['type:alias'],
				limit: 100,
			})

			// Build ALIAS output
			const aliasScript = new Script()
			aliasScript.writeOpCode(OP.OP_FALSE)
			aliasScript.writeOpCode(OP.OP_RETURN)
			aliasScript.writeBin(toArray(BAP_BITCOM_ADDRESS))
			aliasScript.writeBin(toArray('ALIAS'))
			aliasScript.writeBin(toArray(bapId))
			aliasScript.writeBin(toArray(JSON.stringify(input.profile)))

			const outputs: Array<{
				lockingScript: string
				satoshis: number
				outputDescription: string
				basket: string
				tags: string[]
				customInstructions?: string
			}> = []

			if (!existingId) {
				// First time: create ID + ALIAS in one transaction
				const rootKeyId = signingKeyId(0)
				const firstSigningKeyId = signingKeyId(1)

				const idOutput = await buildIdOutput(ctx, bapId, {
					seq: 1,
					signerKeyId: rootKeyId,
					declareKeyId: firstSigningKeyId,
				})

				outputs.push({
					lockingScript: idOutput.lockingScript,
					satoshis: 0,
					outputDescription: 'BAP ID',
					basket: BAP_BASKET,
					tags: idOutput.tags,
					customInstructions: idOutput.customInstructions,
				})

				// ALIAS signed by the newly declared signing key (identity-1)
				const signedAliasScript = await applyBapAip(
					ctx,
					aliasScript,
					firstSigningKeyId,
				)
				outputs.push({
					lockingScript: signedAliasScript.toHex(),
					satoshis: 0,
					outputDescription: 'BAP ALIAS',
					basket: BAP_BASKET,
					tags: ['type:alias', `bapId:${bapId}`, publishedAtTag],
				})
			} else {
				// Existing identity: just update ALIAS signed by current key
				const signedAliasScript = await applyBapAip(ctx, aliasScript)
				outputs.push({
					lockingScript: signedAliasScript.toHex(),
					satoshis: 0,
					outputDescription: 'BAP ALIAS',
					basket: BAP_BASKET,
					tags: ['type:alias', `bapId:${bapId}`, publishedAtTag],
				})
			}

			const result = await executeTrackedAction(
				ctx.wallet,
				{
					description: existingId
						? 'BAP alias update'
						: 'BAP identity creation with profile',
					outputs,
					options: {
						acceptDelayedBroadcast: false,
						randomizeOutputs: false,
					},
				},
				input.fundingProvider,
			)

			if (!result.txid) return { error: 'no-txid-returned' }

			for (const old of existingAliases.outputs) {
				await ctx.wallet.relinquishOutput({
					basket: BAP_BASKET,
					output: old.outpoint,
				})
			}

			return {
				txid: result.txid,
				tx: result.tx,
				bapId,
			}
		} catch (error) {
			console.error('[updateProfile]', error)
			return {
				error: error instanceof Error ? error.message : 'unknown-error',
			}
		}
	},
}

/**
 * Read the current BAP profile (alias) from the wallet's `bap` basket.
 *
 * Parses the ALIAS OP_RETURN locking script to extract the profile JSON.
 * If duplicate alias outputs exist, keeps the first and relinquishes the rest.
 */
export const getProfile: Action<Record<string, never>, ProfileResponse> = {
	meta: {
		name: 'getProfile',
		description: 'Read current BAP identity profile from wallet',
		category: 'identity',
		inputSchema: {
			type: 'object',
			properties: {},
		},
	},
	async execute(ctx) {
		try {
			// Pass 1 — cheap tags-only scan to rank candidates
			const scan = await ctx.wallet.listOutputs({
				basket: BAP_BASKET,
				tags: ['type:alias'],
				includeTags: true,
				limit: 10000,
			})

			const picked = pickNewestAlias(scan.outputs)
			if (!picked) {
				return { error: 'no-profile: no alias output in wallet' }
			}

			// Pass 2 — fetch just the winner's locking script.
			// Prefer id:<hex> exact match; fall back to a wider scan for legacy
			// aliases that predate the id tag convention.
			let winnerOutput: { lockingScript?: string } | undefined
			if (picked.winner.id) {
				const byId = await ctx.wallet.listOutputs({
					basket: BAP_BASKET,
					tags: ['type:alias', `id:${picked.winner.id}`],
					tagQueryMode: 'all',
					include: 'locking scripts',
					limit: 1,
				})
				winnerOutput = byId.outputs[0]
			} else {
				const fallback = await ctx.wallet.listOutputs({
					basket: BAP_BASKET,
					tags: ['type:alias'],
					include: 'locking scripts',
					limit: 10000,
				})
				winnerOutput = fallback.outputs.find(
					(o) => o.outpoint === picked.winner.outpoint,
				)
			}

			if (!winnerOutput?.lockingScript) {
				return { error: 'malformed-alias: winner has no locking script' }
			}

			const lockingScript = Script.fromHex(winnerOutput.lockingScript)

			const bitcom = BitCom.decode(lockingScript)
			if (!bitcom) {
				return { error: 'malformed-alias: no bitcom structure found' }
			}

			const bap = BAP.decode(bitcom)
			if (!bap) {
				return { error: 'malformed-alias: no BAP protocol found in bitcom' }
			}

			const bapId = bap.idKey ?? ''
			const profile = bap.profile as Record<string, unknown>

			for (const loser of picked.losers) {
				await ctx.wallet.relinquishOutput({
					basket: BAP_BASKET,
					output: loser.outpoint,
				})
			}

			return { bapId, profile }
		} catch (error) {
			console.error('[getProfile]', error)
			return {
				error: error instanceof Error ? error.message : 'unknown-error',
			}
		}
	},
}

/** All identity actions for registry */
export const identityActions = [
	publishIdentity,
	rotateIdentity,
	attest,
	updateProfile,
	getProfile,
]
