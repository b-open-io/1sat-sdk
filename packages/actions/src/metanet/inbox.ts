/**
 * The messagebox steps shared by the BRC-169 inbox syncs (`mandala_inbox`,
 * `metanet_inbox`): list a box (BRC-231 over BRC-104), decode each §7.3
 * DAG-CBOR envelope, verify its §7.2 signature against `sender.identityKey`,
 * decrypt the BRC-78 `content` with `wallet.decrypt`, check `contentHash`,
 * parse the MIME entity, hand it to the box's handler, and acknowledge only
 * the messages whose handler succeeded. A message whose handler throws is
 * left in the box and reported with the reason.
 */

import { type MimeEntity, parseMimeEntity } from '@1sat/utils'
import { Hash, Utils, type WalletInterface } from '@bsv/sdk'
import { decryptBrc78 } from './brc78.js'
import {
	type ReceivedEnvelope,
	decodeEnvelope,
	verifyEnvelope,
} from './envelope.js'
import { type CborMessage, messageRelay } from './relay.js'

/** Default messagebox when the caller names none. */
export const DEFAULT_MESSAGEBOX_URL = 'https://messagebox.1sat.app'

/** A message left in the box, and why. */
export interface InboxSkip {
	messageId: string
	reason: string
}

/** Thrown to leave a message unacknowledged with a reason. */
export class InboxSkipError extends Error {}

/** Hex of a byte string of the given length, or InboxSkipError. */
export function bytesHex(b: unknown, length: number, what: string): string {
	if (!(b instanceof Uint8Array) || b.length !== length) {
		throw new InboxSkipError(`${what} must be ${length} bytes`)
	}
	return Utils.toHex(Array.from(b))
}

/** A verified, decrypted envelope. */
export interface OpenedEnvelope {
	env: ReceivedEnvelope
	/** `sender.identityKey`, hex */
	sender: string
	/** The decrypted `content` */
	plaintext: number[]
	entity: MimeEntity
}

/**
 * Decode, verify, decrypt and parse one envelope addressed to this wallet.
 *
 * @throws InboxSkipError when it is not a DAG-CBOR envelope, the signature
 * does not verify, or `contentHash` does not match
 */
export async function openEnvelope(
	wallet: Pick<WalletInterface, 'decrypt'>,
	body: Uint8Array,
): Promise<OpenedEnvelope> {
	let env: ReceivedEnvelope
	try {
		env = decodeEnvelope(body)
	} catch {
		throw new InboxSkipError('not a DAG-CBOR BRC-169 envelope')
	}
	if (!(await verifyEnvelope(env))) {
		throw new InboxSkipError('envelope signature does not verify')
	}
	const sender = bytesHex(env.sender.identityKey, 33, 'sender')
	const plaintext = await decryptBrc78(wallet, env.content, sender)
	if (
		env.contentHash !== undefined &&
		Utils.toHex(Hash.sha256(plaintext)) !==
			Utils.toHex(Array.from(env.contentHash))
	) {
		throw new InboxSkipError('contentHash does not match the content')
	}
	return { env, sender, plaintext, entity: parseMimeEntity(plaintext) }
}

/**
 * List `messageBox`, open each envelope and run `handle` on it; acknowledge
 * the messages `handle` returned for.
 */
export async function processInbox<R>(
	wallet: WalletInterface,
	messageboxUrl: string | undefined,
	messageBox: string,
	handle: (opened: OpenedEnvelope, msg: CborMessage) => Promise<R>,
): Promise<{ received: R[]; skipped: InboxSkip[]; error?: string }> {
	const messagebox =
		messageboxUrl?.replace(/\/+$/, '') || DEFAULT_MESSAGEBOX_URL
	const received: R[] = []
	const skipped: InboxSkip[] = []
	const acknowledged: string[] = []

	let messages: CborMessage[]
	try {
		messages = await messageRelay.listCborMessages(
			wallet,
			messagebox,
			messageBox,
		)
	} catch (error) {
		return {
			received,
			skipped,
			error: error instanceof Error ? error.message : String(error),
		}
	}

	for (const msg of messages) {
		try {
			const opened = await openEnvelope(wallet, msg.body)
			received.push(await handle(opened, msg))
			acknowledged.push(msg.messageId)
		} catch (error) {
			skipped.push({
				messageId: msg.messageId,
				reason: error instanceof Error ? error.message : String(error),
			})
		}
	}

	if (acknowledged.length > 0) {
		try {
			await messageRelay.acknowledgeCborMessages(
				wallet,
				messagebox,
				acknowledged,
			)
		} catch (error) {
			return {
				received,
				skipped,
				error: `acknowledge-failed: ${error instanceof Error ? error.message : String(error)}`,
			}
		}
	}
	return { received, skipped }
}
