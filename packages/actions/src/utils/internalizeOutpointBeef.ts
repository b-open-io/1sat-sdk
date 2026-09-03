import { Inscription } from '@1sat/templates'
import {
	MAP_PREFIX,
	OPNS_BASKET,
	ORDINALS_BASKET,
	displayNameForCi,
	formatOrdinalOutpoint,
	nameFromMap,
	ordinalTagsFromMetadata,
} from '@1sat/types'
import { MapIndexer } from '@1sat/wallet'
import { Script, type WalletInterface } from '@bsv/sdk'
import { randomActionId } from './createTrackedAction.js'
import { buildOrdinalCustomInstructions } from './ordinalRemittance.js'
import { parseOutpointBeef } from './outpointBeef.js'

export interface TipDerivation {
	protocolID: [0 | 1 | 2, string]
	keyID: string
	counterparty?: string
	name?: string
}

export interface InternalizeOutpointBeefResult {
	txid: string
	outpoint: string
	origin: string
	basket: string
	tags: string[]
}

/**
 * Ingest a BRC-158 bundle: fully verify tip→origin in memory, then file
 * the tip alone with BRC-147 tags + customInstructions.
 *
 * Nothing is stored for later proof export — the wallet cannot serve a
 * viable proof back out, so provenance travels sender-to-receiver only.
 * Fail closed: any missing source, broken sat hop, or bad origin envelope
 * throws and files nothing.
 */
export async function internalizeOutpointBeef(
	wallet: WalletInterface,
	bundle: Uint8Array | number[],
	tip: TipDerivation,
	description = 'Received ordinal',
): Promise<InternalizeOutpointBeefResult> {
	const { txid, vout, outpoint, beef } = parseOutpointBeef(bundle)

	const getTx = (id: string) => {
		const tx = beef.findTxid(id)?.tx
		if (!tx) throw new Error(`proof-missing-source:${id}`)
		return tx
	}

	// Walk tip → origin over bundle txs only (BRC-159 sat ordering).
	let current = { txid, vout }
	let origin = outpoint
	for (;;) {
		const tx = getTx(current.txid)
		const out = tx.outputs[current.vout]
		if (!out || (out.satoshis ?? 0) !== 1) {
			if (current.txid === txid) throw new Error('not-a-1sat-tip')
			break
		}
		let outAcc = 0
		for (let j = 0; j < current.vout; j++)
			outAcc += tx.outputs[j]?.satoshis ?? 0

		const sats: number[] = []
		for (const inp of tx.inputs) {
			const srcTxid = inp.sourceTXID ?? inp.sourceTransaction?.id('hex')
			if (!srcTxid) throw new Error('proof-missing-source:unknown-input')
			const srcTx = getTx(srcTxid.toLowerCase())
			const srcOut = srcTx.outputs[inp.sourceOutputIndex]
			if (srcOut?.satoshis == null) {
				throw new Error(`proof-missing-source:${srcTxid}`)
			}
			sats.push(srcOut.satoshis)
		}

		let inAcc = 0
		let ordinalVin = -1
		for (let i = 0; i < sats.length; i++) {
			if (inAcc === outAcc && sats[i] === 1) {
				ordinalVin = i
				break
			}
			inAcc += sats[i] ?? 0
		}
		if (ordinalVin === -1) break
		const vin = tx.inputs[ordinalVin]
		if (!vin) break
		const parentTxid = (
			vin.sourceTXID ??
			vin.sourceTransaction?.id('hex') ??
			''
		).toLowerCase()
		if (!parentTxid) throw new Error('proof-missing-source:unknown-input')
		origin = `${parentTxid}.${vin.sourceOutputIndex ?? 0}`
		current = { txid: parentTxid, vout: vin.sourceOutputIndex ?? 0 }
	}

	// Origin envelope check (BRC-160): first ord envelope on a 1-sat output.
	const [originTxid, originVoutStr] = origin.split('.')
	const originTx = getTx(originTxid ?? '')
	const originOut = originTx.outputs[Number(originVoutStr ?? 0)]
	if (!originOut || (originOut.satoshis ?? 0) !== 1) {
		throw new Error('origin-not-1sat')
	}
	const decoded = Inscription.decode(
		Script.fromBinary(Array.from(originOut.lockingScript.toBinary())),
	)
	if (!decoded) throw new Error('origin-has-no-ord-envelope')
	const baseType = decoded.file.type.split(';')[0]?.trim().toLowerCase()
	if (!baseType) throw new Error('origin-missing-content-type')

	const mapField = decoded.fields?.get(MAP_PREFIX) ?? decoded.fields?.get('MAP')
	const map = mapField
		? (MapIndexer.parseMap(Script.fromBinary(Array.from(mapField)), 0) as
				| Record<string, unknown>
				| undefined)
		: undefined

	let parent: string | undefined
	if (decoded.parent) {
		try {
			const bytes = Array.from(decoded.parent)
			const txidHex = bytes
				.slice(0, 32)
				.reverse()
				.map((b) => (b < 16 ? '0' : '') + b.toString(16))
				.join('')
			const voutNum =
				(bytes[32] ?? 0) |
				((bytes[33] ?? 0) << 8) |
				((bytes[34] ?? 0) << 16) |
				((bytes[35] ?? 0) << 24)
			parent = `${txidHex}.${voutNum}`
		} catch {
			parent = undefined
		}
	}

	const tags = ordinalTagsFromMetadata({
		origin,
		contentType: decoded.file.type,
		map,
		parent,
	})
	if (origin === outpoint) {
		// Mint: this output IS the origin — bare tag, not a self-reference.
		const selfTag = `origin:${formatOrdinalOutpoint(origin)}`
		const at = tags.indexOf(selfTag)
		if (at >= 0) tags.splice(at, 1)
		tags.unshift('origin')
	}
	const actionId = randomActionId()
	tags.push(`id:${actionId}_${vout}`)

	const basket =
		baseType === 'application/op-ns' ? OPNS_BASKET : ORDINALS_BASKET
	const name =
		tip.name ?? displayNameForCi(nameFromMap(map as Record<string, unknown>))
	const customInstructions = buildOrdinalCustomInstructions({
		protocolID: tip.protocolID,
		keyID: tip.keyID,
		counterparty: tip.counterparty,
		tags,
		name,
	})

	await wallet.internalizeAction({
		tx: beef.toBinaryAtomic(txid),
		outputs: [
			{
				outputIndex: vout,
				protocol: 'basket insertion',
				insertionRemittance: { basket, tags, customInstructions },
			},
		],
		description,
	})

	return {
		txid,
		outpoint,
		origin: formatOrdinalOutpoint(origin),
		basket,
		tags,
	}
}
