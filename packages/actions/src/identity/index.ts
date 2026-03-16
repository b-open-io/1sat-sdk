/**
 * Identity Module
 *
 * BAP identity actions using the wallet's identity-{N} key derivation scheme.
 *
 * Key hierarchy:
 *   identity-0 = root key (BAP ID source, signs initial publish)
 *   identity-{N} = current signing key (N tracked via seq tags on outputs)
 *
 * All keys derived at protocolID=[1,"sigma"], keyID="identity-{N}".
 */

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
	rawtx?: string
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
 * the ID record signed by identity-0 via AIP. The output lands in
 * the `bap` basket tagged with seq:1.
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

			const rootKeyId = signingKeyId(0)
			const bapId = await computeBapId(ctx)
			const currentAddress = await deriveAddress(ctx, rootKeyId)

			const script = new Script()
			script.writeOpCode(OP.OP_FALSE)
			script.writeOpCode(OP.OP_RETURN)
			script.writeBin(toArray(BAP_BITCOM_ADDRESS))
			script.writeBin(toArray('ID'))
			script.writeBin(toArray(bapId))
			script.writeBin(toArray(currentAddress))

			const signedScript = await applyBapAip(ctx, script, rootKeyId)

			const result = await executeTrackedAction(
				ctx.wallet,
				{
					description: 'BAP identity publication',
					outputs: [
						{
							lockingScript: signedScript.toHex(),
							satoshis: 0,
							outputDescription: 'BAP ID',
							basket: BAP_BASKET,
							tags: ['type:id', `bapId:${bapId}`, 'seq:1'],
							customInstructions: JSON.stringify({
								protocolID: BAP_PROTOCOL_ID,
								keyID: rootKeyId,
							}),
						},
					],
					options: {
						signAndProcess: true,
						acceptDelayedBroadcast: false,
						randomizeOutputs: false,
					},
				},
				input?.fundingProvider,
			)

			if (!result.txid) return { error: 'no-txid-returned' }

			return {
				txid: result.txid,
				rawtx: result.tx ? Utils.toHex(result.tx) : undefined,
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
			const nextKeyId = signingKeyId(nextSeq - 1)
			const nextAddress = await deriveAddress(ctx, nextKeyId)

			const script = new Script()
			script.writeOpCode(OP.OP_FALSE)
			script.writeOpCode(OP.OP_RETURN)
			script.writeBin(toArray(BAP_BITCOM_ADDRESS))
			script.writeBin(toArray('ID'))
			script.writeBin(toArray(bapId))
			script.writeBin(toArray(nextAddress))

			const signedScript = await applyBapAip(ctx, script, currentKeyId)

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
							lockingScript: signedScript.toHex(),
							satoshis: 0,
							outputDescription: 'BAP ID',
							basket: BAP_BASKET,
							tags: ['type:id', `bapId:${bapId}`, `seq:${nextSeq}`],
							customInstructions: JSON.stringify({
								protocolID: BAP_PROTOCOL_ID,
								keyID: nextKeyId,
							}),
						},
					],
					options: {
						signAndProcess: true,
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
				rawtx: result.tx ? Utils.toHex(result.tx) : undefined,
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
						signAndProcess: true,
						acceptDelayedBroadcast: false,
						randomizeOutputs: false,
					},
				},
				input.fundingProvider,
			)

			if (!result.txid) return { error: 'no-txid-returned' }

			return {
				txid: result.txid,
				rawtx: result.tx ? Utils.toHex(result.tx) : undefined,
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
			const bapId = await resolveBapId(ctx)
			if (!bapId) {
				return { error: 'no-identity: publish identity first' }
			}

			const existing = await ctx.wallet.listOutputs({
				basket: BAP_BASKET,
				tags: ['type:alias'],
				limit: 100,
			})

			const script = new Script()
			script.writeOpCode(OP.OP_FALSE)
			script.writeOpCode(OP.OP_RETURN)
			script.writeBin(toArray(BAP_BITCOM_ADDRESS))
			script.writeBin(toArray('ALIAS'))
			script.writeBin(toArray(bapId))
			script.writeBin(toArray(JSON.stringify(input.profile)))

			const signedScript = await applyBapAip(ctx, script)

			const result = await executeTrackedAction(
				ctx.wallet,
				{
					description: 'BAP alias update',
					outputs: [
						{
							lockingScript: signedScript.toHex(),
							satoshis: 0,
							outputDescription: 'BAP ALIAS',
							basket: BAP_BASKET,
							tags: ['type:alias', `bapId:${bapId}`],
						},
					],
					options: {
						signAndProcess: true,
						acceptDelayedBroadcast: false,
						randomizeOutputs: false,
					},
				},
				input.fundingProvider,
			)

			if (!result.txid) return { error: 'no-txid-returned' }

			for (const old of existing.outputs) {
				await ctx.wallet.relinquishOutput({
					basket: BAP_BASKET,
					output: old.outpoint,
				})
			}

			return {
				txid: result.txid,
				rawtx: result.tx ? Utils.toHex(result.tx) : undefined,
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
			const result = await ctx.wallet.listOutputs({
				basket: BAP_BASKET,
				tags: ['type:alias'],
				include: 'locking scripts',
				includeTags: true,
				limit: 100,
			})

			if (!result.outputs.length) {
				return { error: 'no-profile: no alias output in wallet' }
			}

			const primary = result.outputs[0]
			const script = Script.fromHex(primary.lockingScript ?? '')
			const bapIdChunk = script.chunks[4]?.data
			const profileChunk = script.chunks[5]?.data

			if (!bapIdChunk || !profileChunk) {
				return { error: 'malformed-alias: could not parse locking script' }
			}

			const bapId = Utils.toUTF8(Array.from(bapIdChunk))
			const profile = JSON.parse(
				Utils.toUTF8(Array.from(profileChunk)),
			) as Record<string, unknown>

			for (const dup of result.outputs.slice(1)) {
				await ctx.wallet.relinquishOutput({
					basket: BAP_BASKET,
					output: dup.outpoint,
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
