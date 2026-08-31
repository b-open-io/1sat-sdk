import { ECIES, PrivateKey, Utils } from '@bsv/sdk'

const MEMBER_ENCRYPTION_PATH = "m/424150'/2147483647'/2147483647'"
const BAP_SIGNING_INVOICE = '1-sigma-identity'
const BAP_ID_PATTERN = /^[1-9A-HJ-NP-Za-km-z]{20,64}$/

interface MemberBackupPayload {
	address: string
	counter?: number
	derivedPrivateKey: string
	identityKey: string
}

/**
 * Decode both current plaintext-ID account backups and the encrypted MemberID
 * backup emitted by bsv-bap 0.1.x.
 */
export function decodeBapAccountBackup(backup: {
	wif: string
	id: string
}): { identityKey: string; rootKey: PrivateKey } {
	const wrapperKey = PrivateKey.fromWif(backup.wif)
	if (BAP_ID_PATTERN.test(backup.id)) {
		return { identityKey: backup.id, rootKey: wrapperKey }
	}

	const encryptionKey = wrapperKey.deriveChild(
		wrapperKey.toPublicKey(),
		MEMBER_ENCRYPTION_PATH,
	)
	let decoded: unknown
	try {
		const plaintext = Utils.toUTF8(
			ECIES.electrumDecrypt(Utils.toArray(backup.id, 'base64'), encryptionKey),
		)
		decoded = JSON.parse(plaintext)
	} catch {
		throw new Error('BAP account backup contains an unreadable member identity')
	}
	if (typeof decoded !== 'object' || decoded === null) {
		throw new Error('BAP account backup contains an invalid member identity')
	}
	const payload = decoded as Partial<MemberBackupPayload>

	if (
		typeof payload.derivedPrivateKey !== 'string' ||
		typeof payload.identityKey !== 'string' ||
		typeof payload.address !== 'string' ||
		!BAP_ID_PATTERN.test(payload.identityKey)
	) {
		throw new Error('BAP account backup contains an invalid member identity')
	}
	const counter = payload.counter ?? 0
	if (!Number.isSafeInteger(counter) || counter < 0) {
		throw new Error('BAP account backup contains an invalid rotation counter')
	}

	let rootKey: PrivateKey
	try {
		rootKey = PrivateKey.fromWif(payload.derivedPrivateKey)
	} catch {
		throw new Error('BAP account backup contains an invalid member private key')
	}
	const currentKey = rootKey.deriveChild(
		rootKey.toPublicKey(),
		`bap:${counter}`,
	)
	const signingKey = currentKey.deriveChild(
		currentKey.toPublicKey(),
		BAP_SIGNING_INVOICE,
	)
	if (signingKey.toPublicKey().toAddress() !== payload.address) {
		throw new Error('BAP account backup member key does not match its address')
	}

	return { identityKey: payload.identityKey, rootKey }
}
