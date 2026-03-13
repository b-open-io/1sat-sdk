/**
 * Identity Module
 *
 * BAP identity actions: attestations and alias/profile updates.
 * Uses the wallet's BAP signing key ([1, "sigma"] / "identity") via applyAip.
 *
 * Prerequisite: Sigma Identity must seed the wallet's `bap` basket with
 * an output tagged `type:id` and `bapId:<hash>` so actions can resolve
 * the BAP identity key from wallet state.
 */

import {
	BSM,
	BigNumber,
	OP,
	PublicKey,
	Script,
	Signature,
	Utils,
} from '@bsv/sdk'
import {
	BAP_BASKET,
	BAP_BITCOM_ADDRESS,
	BAP_KEY_ID,
	BAP_PROTOCOL_ID,
} from '../constants'
import { applyAip } from '../signing/aip'
import type { Action, OneSatContext } from '../types'

const { toArray, toUTF8 } = Utils

const AIP_PREFIX = '15PciHG22SNLQJXMoSUaWVi7WSqc7hCfva'

// ============================================================================
// BAP ID Resolution
// ============================================================================

/**
 * Resolve the BAP identity key from the wallet's `bap` basket.
 *
 * Looks for an output tagged `type:id` and extracts the `bapId:` tag value.
 * Returns null if no identity output exists (Sigma Identity hasn't seeded
 * the wallet yet).
 */
export async function resolveBapId(ctx: OneSatContext): Promise<string | null> {
	const result = await ctx.wallet.listOutputs({
		basket: BAP_BASKET,
		tags: ['type:id'],
		includeTags: true,
		limit: 1,
	})

	if (!result.outputs.length) return null

	const output = result.outputs[0]
	const bapIdTag = output.tags?.find((t) => t.startsWith('bapId:'))
	if (!bapIdTag) return null

	return bapIdTag.slice('bapId:'.length)
}

// ============================================================================
// Types
// ============================================================================

export interface PublishIdentityRequest {
	/** Pre-signed BAP ID locking script hex (AIP-signed with root key) */
	signedScript: string
}

export interface AttestRequest {
	/** SHA-256 hash of the attestation URN (urn:bap:id:attribute:value:nonce) */
	attestationHash: string
	/** Attestation sequence number (default "0") */
	counter?: string
}

export interface UpdateProfileRequest {
	/** Schema.org profile data (e.g. { "@type": "Person", "name": "Alice" }) */
	profile: Record<string, unknown>
}

export interface IdentityResponse {
	txid?: string
	rawtx?: string
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
 * Parse and validate a BAP ID locking script.
 *
 * Expected format:
 *   OP_FALSE OP_RETURN <BAP_PREFIX> <"ID"> <bapId> <currentAddress> | <AIP_PREFIX> <algorithm> <address> <signature>
 *
 * Validates:
 * 1. Script structure (BAP prefix, "ID" command, required fields)
 * 2. AIP signature over the OP_RETURN content
 * 3. currentAddress matches the wallet's BAP-derived key
 */
async function validateBapIdScript(
	ctx: OneSatContext,
	script: Script,
): Promise<
	{ bapId: string; currentAddress: string } | { error: string }
> {
	const chunks = script.chunks

	// Minimum: OP_FALSE OP_RETURN BAP_PREFIX "ID" bapId currentAddress | AIP_PREFIX algorithm address signature
	if (chunks.length < 10) {
		return { error: 'invalid-script: too few chunks' }
	}

	// Verify OP_FALSE OP_RETURN prefix
	if (chunks[0].op !== OP.OP_FALSE || chunks[1].op !== OP.OP_RETURN) {
		return { error: 'invalid-script: missing OP_FALSE OP_RETURN' }
	}

	// Verify BAP prefix
	const prefix = chunks[2]?.data
		? toUTF8(Array.from(chunks[2].data))
		: ''
	if (prefix !== BAP_BITCOM_ADDRESS) {
		return { error: 'invalid-script: not a BAP record' }
	}

	// Verify "ID" command
	const command = chunks[3]?.data
		? toUTF8(Array.from(chunks[3].data))
		: ''
	if (command !== 'ID') {
		return { error: 'invalid-script: not a BAP ID record' }
	}

	// Extract bapId and currentAddress
	const bapIdData = chunks[4]?.data
	const currentAddressData = chunks[5]?.data
	if (!bapIdData || !currentAddressData) {
		return { error: 'invalid-script: missing bapId or currentAddress' }
	}
	const bapId = toUTF8(Array.from(bapIdData))
	const currentAddress = toUTF8(Array.from(currentAddressData))

	// Find the pipe delimiter and AIP suffix
	let aipStart = -1
	for (let i = 6; i < chunks.length; i++) {
		const data = chunks[i]?.data
		if (data && toUTF8(Array.from(data)) === '|') {
			aipStart = i + 1
			break
		}
	}

	if (aipStart < 0 || aipStart + 3 >= chunks.length) {
		return { error: 'invalid-script: missing AIP signature' }
	}

	// Verify AIP prefix
	const aipPrefixData = chunks[aipStart]?.data
	if (!aipPrefixData || toUTF8(Array.from(aipPrefixData)) !== AIP_PREFIX) {
		return { error: 'invalid-script: invalid AIP prefix' }
	}

	const aipAddressData = chunks[aipStart + 2]?.data
	const aipSigBytes = chunks[aipStart + 3]?.data
	if (!aipAddressData || !aipSigBytes) {
		return { error: 'invalid-script: incomplete AIP signature' }
	}
	const aipAddress = toUTF8(Array.from(aipAddressData))

	// Build the AIP message buffer (OP_RETURN + all push data before the pipe)
	const message: number[] = [OP.OP_RETURN]
	for (let i = 2; i < chunks.length; i++) {
		const data = chunks[i]?.data
		if (data && toUTF8(Array.from(data)) === '|') break
		if (data && data.length > 0) {
			message.push(...Array.from(data))
		}
	}

	// Verify AIP signature
	const bsmHash = BSM.magicHash(message)
	const sig = Signature.fromCompact(
		Utils.toBase64(Array.from(aipSigBytes)),
		'base64',
	)

	let sigValid = false
	for (let recovery = 0; recovery < 4; recovery++) {
		try {
			const pubKey = sig.RecoverPublicKey(
				recovery,
				new BigNumber(bsmHash),
			)
			if (
				BSM.verify(message, sig, pubKey) &&
				pubKey.toAddress() === aipAddress
			) {
				sigValid = true
				break
			}
		} catch {
			// try next recovery factor
		}
	}

	if (!sigValid) {
		return { error: 'invalid-signature: AIP signature verification failed' }
	}

	// Verify currentAddress matches this wallet's BAP-derived key
	const { publicKey: walletBapPubKey } = await ctx.wallet.getPublicKey({
		protocolID: BAP_PROTOCOL_ID,
		keyID: BAP_KEY_ID,
		counterparty: 'self',
	})
	const walletBapAddress = PublicKey.fromString(walletBapPubKey).toAddress()

	if (currentAddress !== walletBapAddress) {
		return {
			error: `address-mismatch: script currentAddress ${currentAddress} does not match wallet BAP address ${walletBapAddress}`,
		}
	}

	return { bapId, currentAddress }
}

/**
 * Publish a BAP ID record using a pre-signed locking script.
 *
 * The caller (Sigma Identity) signs the ID OP_RETURN with the root key
 * via PrivateKeySigner + AIP. This action validates the script, verifies
 * the AIP signature, confirms the currentAddress matches this wallet,
 * then funds the transaction via the BRC-100 wallet. The output lands
 * in the `bap` basket so that resolveBapId() can find it.
 *
 * For Droplit-funded onboarding, use internalizeAction() directly instead.
 */
export const publishIdentity: Action<PublishIdentityRequest, IdentityResponse> =
	{
		meta: {
			name: 'publishIdentity',
			description:
				'Publish a BAP ID record from a pre-signed script, funded by the wallet',
			category: 'identity',
			inputSchema: {
				type: 'object',
				properties: {
					signedScript: {
						type: 'string',
						description:
							'Pre-signed BAP ID locking script hex (AIP-signed with root key)',
					},
				},
				required: ['signedScript'],
			},
		},
		async execute(ctx, input) {
			try {
				const script = Script.fromHex(input.signedScript)
				const validation = await validateBapIdScript(ctx, script)

				if ('error' in validation) {
					return { error: validation.error }
				}

				const { bapId } = validation

				const result = await ctx.wallet.createAction({
					description: 'BAP identity publication',
					outputs: [
						{
							lockingScript: input.signedScript,
							satoshis: 0,
							outputDescription: 'BAP ID',
							basket: BAP_BASKET,
							tags: ['type:id', `bapId:${bapId}`],
						},
					],
					options: {
						signAndProcess: true,
						acceptDelayedBroadcast: false,
						randomizeOutputs: false,
					},
				})

				if (!result.txid) return { error: 'no-txid-returned' }

				return {
					txid: result.txid,
					rawtx: result.tx ? Utils.toHex(result.tx) : undefined,
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
 * Publish a BAP ATTEST transaction.
 *
 * OP_RETURN: BAP_PREFIX | "ATTEST" | attestation_hash | counter
 * Signed with AIP via the wallet's BAP signing key.
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
			const script = new Script()
			script.writeOpCode(OP.OP_FALSE)
			script.writeOpCode(OP.OP_RETURN)
			script.writeBin(toArray(BAP_BITCOM_ADDRESS))
			script.writeBin(toArray('ATTEST'))
			script.writeBin(toArray(input.attestationHash))
			script.writeBin(toArray(input.counter ?? '0'))

			const signedScript = await applyAip(ctx, script)

			const result = await ctx.wallet.createAction({
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
			})

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
 * Signed with AIP via the wallet's BAP signing key.
 *
 * The BAP ID is resolved from the wallet's `bap` basket (seeded by Sigma Identity).
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
				return {
					error: 'no-bap-identity: publish identity via Sigma Identity first',
				}
			}

			// Find existing alias outputs to relinquish after the new one is created
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

			const signedScript = await applyAip(ctx, script)

			const result = await ctx.wallet.createAction({
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
			})

			if (!result.txid) return { error: 'no-txid-returned' }

			// Relinquish old alias outputs now that the new one is committed
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

			// Parse profile from the first output's locking script
			const primary = result.outputs[0]
			const script = Script.fromHex(primary.lockingScript ?? '')
			// Script: OP_FALSE OP_RETURN <BAP_PREFIX> <"ALIAS"> <bapId> <profileJson> [| AIP...]
			// Chunks: [0]=OP_FALSE [1]=OP_RETURN [2]=BAP_PREFIX [3]="ALIAS" [4]=bapId [5]=profileJson
			const bapIdChunk = script.chunks[4]?.data
			const profileChunk = script.chunks[5]?.data

			if (!bapIdChunk || !profileChunk) {
				return { error: 'malformed-alias: could not parse locking script' }
			}

			const bapId = Utils.toUTF8(Array.from(bapIdChunk))
			const profile = JSON.parse(
				Utils.toUTF8(Array.from(profileChunk)),
			) as Record<string, unknown>

			// Relinquish duplicates
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
export const identityActions = [publishIdentity, attest, updateProfile, getProfile]
