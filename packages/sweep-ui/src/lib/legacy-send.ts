import type { IndexedOutput } from '@1sat/types'
import { MAP_PREFIX } from '@1sat/types'
import { parseOutpoint } from '@1sat/utils'
import { OP, P2PKH, PrivateKey, Script, Transaction, Utils } from '@bsv/sdk'
import type { LegacyKeys } from '../types'
import { deriveAddress } from './scanner'
import { getServices } from './services'

export interface LegacySendResult {
	txid: string
	rawtx: string
}

async function fetchSourceTx(txid: string): Promise<Transaction> {
	const services = getServices()
	const beef = await services.getBeefForTxid(txid)
	const found = beef.findTxid(txid)
	if (!found?.tx) throw new Error(`Transaction ${txid} not found in BEEF`)
	return found.tx
}

function buildKeyMap(keys: LegacyKeys): Map<string, PrivateKey> {
	const map = new Map<string, PrivateKey>()
	const payKey = PrivateKey.fromWif(keys.payPk)
	const ordKey = PrivateKey.fromWif(keys.ordPk)
	map.set(deriveAddress(keys.payPk), payKey)
	map.set(deriveAddress(keys.ordPk), ordKey)
	if (keys.identityPk) {
		map.set(deriveAddress(keys.identityPk), PrivateKey.fromWif(keys.identityPk))
	}
	return map
}

function keyForOutput(
	output: IndexedOutput,
	keyMap: Map<string, PrivateKey>,
	fallback: PrivateKey,
): PrivateKey {
	if (output.events) {
		for (const event of output.events) {
			if (event.startsWith('own:') || event.startsWith('p2pkh:')) {
				const addr = event.split(':')[1]
				const key = keyMap.get(addr)
				if (key) return key
			}
		}
	}
	return fallback
}

export async function legacySendBsv(params: {
	funding: IndexedOutput[]
	keys: LegacyKeys
	destination: string
	amount?: number
}): Promise<LegacySendResult> {
	const { funding, keys, destination, amount } = params
	if (!funding.length) throw new Error('No funding UTXOs')
	if (!destination) throw new Error('No destination address')

	const keyMap = buildKeyMap(keys)
	const payKey = PrivateKey.fromWif(keys.payPk)
	const sourceAddress = payKey.toPublicKey().toAddress()
	const p2pkh = new P2PKH()
	const tx = new Transaction()

	for (const utxo of funding) {
		const { txid, vout } = parseOutpoint(utxo.outpoint)
		const key = keyForOutput(utxo, keyMap, payKey)
		tx.addInput({
			sourceTXID: txid,
			sourceOutputIndex: vout,
			sourceTransaction: await fetchSourceTx(txid),
			unlockingScriptTemplate: p2pkh.unlock(key),
			sequence: 0xffffffff,
		})
	}

	if (amount) {
		tx.addOutput({
			lockingScript: p2pkh.lock(destination),
			satoshis: amount,
		})
		tx.addOutput({
			lockingScript: p2pkh.lock(sourceAddress),
			change: true,
		})
	} else {
		tx.addOutput({
			lockingScript: p2pkh.lock(destination),
			change: true,
		})
	}

	await tx.fee()
	await tx.sign()

	const rawTx = tx.toBinary()
	const result = await getServices().submitToStack(rawTx)

	return {
		txid: result.txid,
		rawtx: Utils.toHex(rawTx),
	}
}

export async function legacySendOrdinals(params: {
	ordinals: IndexedOutput[]
	funding: IndexedOutput[]
	keys: LegacyKeys
	destination: string
}): Promise<LegacySendResult> {
	const { ordinals, funding, keys, destination } = params
	if (!ordinals.length) throw new Error('No ordinals to send')
	if (!funding.length) throw new Error('No funding UTXOs for fees')
	if (!destination) throw new Error('No destination address')

	const keyMap = buildKeyMap(keys)
	const payKey = PrivateKey.fromWif(keys.payPk)
	const sourceAddress = payKey.toPublicKey().toAddress()
	const p2pkh = new P2PKH()
	const tx = new Transaction()

	for (const ord of ordinals) {
		const { txid, vout } = parseOutpoint(ord.outpoint)
		const key = keyForOutput(ord, keyMap, payKey)
		tx.addInput({
			sourceTXID: txid,
			sourceOutputIndex: vout,
			sourceTransaction: await fetchSourceTx(txid),
			unlockingScriptTemplate: p2pkh.unlock(key),
			sequence: 0xffffffff,
		})
	}

	for (const _ord of ordinals) {
		tx.addOutput({
			lockingScript: p2pkh.lock(destination),
			satoshis: 1,
		})
	}

	for (const utxo of funding) {
		const { txid, vout } = parseOutpoint(utxo.outpoint)
		const key = keyForOutput(utxo, keyMap, payKey)
		tx.addInput({
			sourceTXID: txid,
			sourceOutputIndex: vout,
			sourceTransaction: await fetchSourceTx(txid),
			unlockingScriptTemplate: p2pkh.unlock(key),
			sequence: 0xffffffff,
		})
	}

	tx.addOutput({
		lockingScript: p2pkh.lock(sourceAddress),
		change: true,
	})

	await tx.fee()
	await tx.sign()

	const rawTx = tx.toBinary()
	const result = await getServices().submitToStack(rawTx)

	return {
		txid: result.txid,
		rawtx: Utils.toHex(rawTx),
	}
}

export async function legacyBurnOrdinals(params: {
	ordinals: IndexedOutput[]
	funding: IndexedOutput[]
	keys: LegacyKeys
}): Promise<LegacySendResult> {
	const { ordinals, funding, keys } = params
	if (!ordinals.length) throw new Error('No ordinals to burn')

	const keyMap = buildKeyMap(keys)
	const payKey = PrivateKey.fromWif(keys.payPk)
	const sourceAddress = payKey.toPublicKey().toAddress()
	const p2pkh = new P2PKH()
	const tx = new Transaction()

	for (const ord of ordinals) {
		const { txid, vout } = parseOutpoint(ord.outpoint)
		const key = keyForOutput(ord, keyMap, payKey)
		tx.addInput({
			sourceTXID: txid,
			sourceOutputIndex: vout,
			sourceTransaction: await fetchSourceTx(txid),
			unlockingScriptTemplate: p2pkh.unlock(key),
			sequence: 0xffffffff,
		})
	}

	for (const utxo of funding) {
		const { txid, vout } = parseOutpoint(utxo.outpoint)
		const key = keyForOutput(utxo, keyMap, payKey)
		tx.addInput({
			sourceTXID: txid,
			sourceOutputIndex: vout,
			sourceTransaction: await fetchSourceTx(txid),
			unlockingScriptTemplate: p2pkh.unlock(key),
			sequence: 0xffffffff,
		})
	}

	const burnScript = new Script()
		.writeOpCode(OP.OP_FALSE)
		.writeOpCode(OP.OP_RETURN)
		.writeBin(Utils.toArray(MAP_PREFIX))
		.writeBin(Utils.toArray('SET'))
		.writeBin(Utils.toArray('app'))
		.writeBin(Utils.toArray('1sat-sweep'))
		.writeBin(Utils.toArray('type'))
		.writeBin(Utils.toArray('ord'))
		.writeBin(Utils.toArray('op'))
		.writeBin(Utils.toArray('burn'))
	tx.addOutput({ satoshis: 0, lockingScript: burnScript })

	tx.addOutput({
		lockingScript: p2pkh.lock(sourceAddress),
		change: true,
	})

	await tx.fee()
	await tx.sign()

	const rawTx = tx.toBinary()
	const result = await getServices().submitToStack(rawTx)

	return {
		txid: result.txid,
		rawtx: Utils.toHex(rawTx),
	}
}
