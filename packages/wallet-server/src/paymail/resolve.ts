/**
 * Resolve OpNS alias → identity via tip UTXO PushDrop bind.
 */

import { OneSatServices } from '@1sat/client'
import { P1SAT_PROTOCOL, opnsRegisterKeyId } from '@1sat/types'
import {
	LockingScript,
	ProtoWallet,
	PushDrop,
	Transaction,
	Utils,
} from '@bsv/sdk'
import type { ResolvedBind } from './types'

function parseOutpoint(outpoint: string): { txid: string; vout: number } {
	const normalized = outpoint.replace('_', '.')
	const [txid, voutStr] = normalized.split('.')
	const vout = Number(voutStr)
	if (!txid || !Number.isFinite(vout)) {
		throw new Error(`invalid outpoint: ${outpoint}`)
	}
	return { txid, vout }
}

/**
 * Load tip locking script for alias, verify PushDrop bind, return identity key.
 */
export async function resolvePaymailBind(
	services: OneSatServices,
	alias: string,
): Promise<ResolvedBind> {
	const { outpoint } = await services.opns.getOrigin(alias)
	const { txid, vout } = parseOutpoint(outpoint)

	const beefBytes = await services.beef.getBeef(txid)
	const tx = Transaction.fromBEEF(Array.from(beefBytes))
	const output = tx.outputs[vout]
	if (!output?.lockingScript) {
		throw new Error(`no output at ${outpoint}`)
	}

	const identityKey = await verifyPushDropBind(tx, vout, output.lockingScript)
	return { identityKey, outpoint: `${txid}.${vout}` }
}

export async function verifyPushDropBind(
	tx: Transaction,
	vout: number,
	lockingScript: LockingScript,
): Promise<string> {
	const decoded = PushDrop.decode(lockingScript)
	if (decoded.fields.length < 2) {
		throw new Error('not a signed PushDrop bind')
	}

	const fields = decoded.fields.map((f) => [...f])
	const signature = fields.pop() as number[]
	const idKeyBytes = fields[0]
	if (!idKeyBytes?.length) {
		throw new Error('missing identity field')
	}
	const identityKey = Utils.toHex(idKeyBytes)

	const input = tx.inputs[0]
	const sourceTxid =
		input.sourceTXID ?? input.sourceTransaction?.id('hex') ?? ''
	const sourceVout = input.sourceOutputIndex
	if (!sourceTxid) {
		throw new Error('missing creation input outpoint')
	}
	const keyID = opnsRegisterKeyId(`${sourceTxid}.${sourceVout}`)

	const anyone = new ProtoWallet('anyone')
	const { publicKey: expectedLockPub } = await anyone.getPublicKey({
		protocolID: P1SAT_PROTOCOL,
		keyID,
		counterparty: identityKey,
		forSelf: true,
	})
	if (expectedLockPub !== decoded.lockingPublicKey.toString()) {
		throw new Error('lock pubkey does not match bind derivation')
	}

	const data = fields.reduce<number[]>((a, e) => [...a, ...e], [])
	const { valid } = await anyone.verifySignature({
		data,
		signature,
		protocolID: P1SAT_PROTOCOL,
		keyID,
		counterparty: identityKey,
	})
	if (!valid) {
		throw new Error('invalid PushDrop field signature')
	}

	return identityKey
}
