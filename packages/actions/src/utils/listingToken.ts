import { BSV20, BSV21, type BSV20TokenData, type BSV21TokenData } from '@1sat/templates'
import {
	BSV21_BASKET,
	MAX_TOKEN_SUPPLY,
	TOKEN_CONTENT_TYPE,
} from '@1sat/types'
import {
	type CreateActionOutput,
	P2PKH,
	type WalletOutput,
} from '@bsv/sdk'
import {
	bsv21FieldsFromOutput,
	bsv21FilterTags,
	buildBsv21CustomInstructions,
} from './bsv21Remittance.js'

/** Transfer fields already defined on the template token types. */
export type Bsv21Transfer = Required<Pick<BSV21TokenData, 'id' | 'amt'>>
export type Bsv20Transfer = Required<Pick<BSV20TokenData, 'tick' | 'amt'>>
export type ListedTransfer = Bsv21Transfer | Bsv20Transfer

export function isBsv21Transfer(
	token: ListedTransfer,
): token is Bsv21Transfer {
	return 'id' in token
}

function integerAmt(value: string | undefined): string | undefined {
	if (!value || !/^\d+$/.test(value)) return undefined
	const amt = BigInt(value)
	if (amt <= 0n || amt > MAX_TOKEN_SUPPLY) return undefined
	return amt.toString()
}

/**
 * Token identity for a listed 1-sat. `undefined` means it is not
 * `application/bsv-20`. Throws if the MIME is token but id/tick/amt is missing.
 */
export function listedTransfer(
	output: Pick<WalletOutput, 'tags' | 'customInstructions'>,
): ListedTransfer | undefined {
	const type = output.tags
		?.find((tag) => tag.startsWith('type:'))
		?.slice('type:'.length)
	const fields = bsv21FieldsFromOutput({
		satoshis: 1,
		outpoint: '',
		tags: output.tags,
		customInstructions: output.customInstructions,
	} as WalletOutput)
	if (type !== TOKEN_CONTENT_TYPE && !fields.tokenId) return undefined

	const amt = integerAmt(fields.amt)
	if (fields.tokenId && amt) return { id: fields.tokenId, amt }

	let tick: string | undefined
	try {
		const ci = output.customInstructions
			? (JSON.parse(output.customInstructions) as { tick?: unknown })
			: undefined
		if (typeof ci?.tick === 'string' && ci.tick.length > 0) tick = ci.tick
	} catch {
		/* listing CI may be derivation-only */
	}
	if (tick && amt) return { tick, amt }

	throw new Error('token-listing-requires-transfer-identity')
}

export function isTokenListing(
	output: Pick<WalletOutput, 'tags' | 'customInstructions'>,
): boolean {
	try {
		return listedTransfer(output) !== undefined
	} catch {
		return true
	}
}

export function tokenTransferLock(address: string, token: ListedTransfer) {
	const dest = new P2PKH().lock(address)
	const amt = BigInt(token.amt)
	if (isBsv21Transfer(token)) return BSV21.transfer(token.id, amt).lock(dest)
	return BSV20.transfer(token.tick, amt).lock(dest)
}

export function tokenReturnOutput(opts: {
	address: string
	token: ListedTransfer
	keyID: string
	protocolID: unknown
	description: string
}): CreateActionOutput {
	const { address, token, keyID, protocolID, description } = opts
	const output: CreateActionOutput = {
		lockingScript: tokenTransferLock(address, token).toHex(),
		satoshis: 1,
		outputDescription: description,
	}
	if (!isBsv21Transfer(token)) return output
	output.basket = BSV21_BASKET
	output.tags = bsv21FilterTags({ tokenId: token.id })
	output.customInstructions = buildBsv21CustomInstructions({
		token: { id: token.id, amt: token.amt, op: 'transfer' },
		protocolID,
		keyID,
		counterparty: 'self',
	})
	return output
}
