import { BigNumber, BSM, PublicKey, Signature, Utils } from '@bsv/sdk'
import { BAP_PROTOCOL_ID } from '../constants'
import { computeBapId } from '../identity'
import type { OneSatContext } from '../types'
import { resolveCurrentKeyId } from './aip'

export interface BapSignature {
	bapId: string
	address: string
	signature: string
	publicKey: string
	message: string
}

/**
 * Sign an arbitrary message with the wallet's current BAP signing key.
 *
 * Resolves the current key from the BAP basket (highest seq output),
 * signs using BSM format, and returns the BAP ID, address, compact
 * signature, and public key — everything a verifier needs.
 */
export async function signWithBap(
	ctx: OneSatContext,
	message: string,
): Promise<BapSignature> {
	const keyID = await resolveCurrentKeyId(ctx)
	const bapId = await computeBapId(ctx)

	const messageBytes = Utils.toArray(message, 'utf8')
	const msgHash = BSM.magicHash(messageBytes)

	const result = await ctx.wallet.createSignature({
		protocolID: BAP_PROTOCOL_ID,
		keyID,
		counterparty: 'self',
		hashToDirectlySign: Array.from(msgHash),
	})

	const pubKeyResult = await ctx.wallet.getPublicKey({
		protocolID: BAP_PROTOCOL_ID,
		keyID,
		forSelf: true,
	})

	const publicKey = PublicKey.fromString(pubKeyResult.publicKey)
	const signature = Signature.fromDER(result.signature)
	const recovery = signature.CalculateRecoveryFactor(
		publicKey,
		new BigNumber(msgHash),
	)

	return {
		bapId,
		address: publicKey.toAddress(),
		signature: signature.toCompact(recovery, true, 'base64') as string,
		publicKey: pubKeyResult.publicKey,
		message,
	}
}
