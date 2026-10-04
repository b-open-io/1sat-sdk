/**
 * BRC-33 message relay in the BRC-231 binary encoding, over BRC-104
 * (AuthFetch): requests and responses are DAG-CBOR, the message body and
 * identity keys are byte strings.
 *
 * - `POST /sendMessage` `{ message: { recipient: bstr(33), messageBox, body: bstr } }`
 *   → `{ status, messageId }`
 * - `POST /listMessages` `{ messageBox }`
 *   → `{ status, messages: [ { messageId, body: bstr, sender: bstr(33) } ] }`
 * - `POST /acknowledgeMessage` `{ messageIds }` → `{ status }`
 */

import { AuthFetch, Utils, type WalletInterface } from '@bsv/sdk'
import {
	decode as dagCborDecode,
	encode as dagCborEncode,
} from '@ipld/dag-cbor'

/** A listed BRC-231 message. */
export interface CborMessage {
	messageId: string
	body: Uint8Array
	sender: Uint8Array
}

async function postCbor<T>(
	wallet: WalletInterface,
	messagebox: string,
	path: string,
	request: unknown,
): Promise<T> {
	const res = await new AuthFetch(wallet).fetch(
		`${messagebox.replace(/\/+$/, '')}${path}`,
		{
			method: 'POST',
			headers: { 'Content-Type': 'application/cbor' },
			body: dagCborEncode(request),
		},
	)
	if (!res.ok) {
		throw new Error(`${path.slice(1)} ${res.status}`)
	}
	return dagCborDecode(new Uint8Array(await res.arrayBuffer())) as T
}

export async function sendCborMessage(
	wallet: WalletInterface,
	messagebox: string,
	recipient: string,
	messageBox: string,
	body: Uint8Array,
): Promise<{ status: string; messageId: string }> {
	return postCbor(wallet, messagebox, '/sendMessage', {
		message: {
			recipient: Uint8Array.from(Utils.toArray(recipient, 'hex')),
			messageBox,
			body,
		},
	})
}

export async function listCborMessages(
	wallet: WalletInterface,
	messagebox: string,
	messageBox: string,
): Promise<CborMessage[]> {
	const res = await postCbor<{ status: string; messages?: CborMessage[] }>(
		wallet,
		messagebox,
		'/listMessages',
		{ messageBox },
	)
	return res.messages ?? []
}

export async function acknowledgeCborMessages(
	wallet: WalletInterface,
	messagebox: string,
	messageIds: string[],
): Promise<{ status: string }> {
	return postCbor(wallet, messagebox, '/acknowledgeMessage', { messageIds })
}

/**
 * The relay calls the Mandala actions make, gathered in one object so a host
 * or a test can substitute the transport.
 */
export const messageRelay = {
	sendCborMessage,
	listCborMessages,
	acknowledgeCborMessages,
}
