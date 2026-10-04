/**
 * BRC-33 `sendMessage` in the BRC-231 binary encoding, over BRC-104
 * (AuthFetch): `POST <messagebox>/sendMessage` with
 * `{ message: { recipient: bstr(33), messageBox: tstr, body: bstr } }` as
 * DAG-CBOR, answered `{ status, messageId }` in DAG-CBOR.
 */

import { AuthFetch, Utils, type WalletInterface } from '@bsv/sdk'
import {
	decode as dagCborDecode,
	encode as dagCborEncode,
} from '@ipld/dag-cbor'

export async function sendCborMessage(
	wallet: WalletInterface,
	messagebox: string,
	recipient: string,
	messageBox: string,
	body: Uint8Array,
): Promise<{ status: string; messageId: string }> {
	const request = dagCborEncode({
		message: {
			recipient: Uint8Array.from(Utils.toArray(recipient, 'hex')),
			messageBox,
			body,
		},
	})
	const res = await new AuthFetch(wallet).fetch(
		`${messagebox.replace(/\/+$/, '')}/sendMessage`,
		{
			method: 'POST',
			headers: { 'Content-Type': 'application/cbor' },
			body: request,
		},
	)
	if (!res.ok) {
		throw new Error(`sendMessage ${res.status}`)
	}
	return dagCborDecode(new Uint8Array(await res.arrayBuffer())) as {
		status: string
		messageId: string
	}
}
