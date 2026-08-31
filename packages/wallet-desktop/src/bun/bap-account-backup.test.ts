import { describe, expect, test } from 'bun:test'
import { decodeBapAccountBackup } from './bap-account-backup'

// Exported by bsv-bap 0.1.24 MemberID.exportForBackup and verified by
// MemberID.fromBackup. The member key is private scalar 2 with counter 3.
const MEMBER_VECTOR = {
	wif: 'KwDiBf89QgGbjEhKnhXJuH7LrciVrZi3qYjgd9M7rFU74NMTptX4',
	id: 'QklFMQPbYgBIG6NByG4zmcr62x6xXmaH7CnAZk1dtLIPMet8v/Fb2SqIPkGndkXrIfmGZv8C/x7R5UfilU7SfCicDukhfdsNe6EK3jBhUMCh7dy5XQsNwY4GLsxQtg9gzQDkKuKh/TKhZV8/Um3vHKZrTFUWB3pnnAcetDESxlwvTaoc9Zn0+hNj7qYC7zWvazrKR3kziQxdZoIG9RzgMNhDI0QyCKfDiRDP6CC66tZZFp/Ju5EELzJ1aCmSEN5dxbkSMSaNaE+haPKaRmttMOOl1aqp3UGvP/DvqadQhJ2A/vBIaFpAN2jrgUSzeHW4GnrqdzJgXGuzAgtT960xANkwgse5MKzeJEJB3mp7BHLiojcKtHBarKWCCFY16cKtpioDSO8+Mgmp/VEvpJjPuE1rxKyadvHObzVtJIqewpVvALxtF69Tq+nPyHdnw8OEd4Xg2g8=',
}

describe('BAP account backup decoding', () => {
	test('recovers the encrypted member identity and actual private key', () => {
		const decoded = decodeBapAccountBackup(MEMBER_VECTOR)

		expect(decoded.identityKey).toBe('Go8vCHAa4S6AhXKTABGpANiz35J')
		expect(decoded.rootKey.toWif()).toBe(
			'KwDiBf89QgGbjEhKnhXJuH7LrciVrZi3qYjgd9M7rFU74NMTptX4',
		)
		expect(decoded.rootKey.toPublicKey().toString()).toBe(
			'02c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5',
		)
		expect(decoded.identityKey).not.toBe(MEMBER_VECTOR.id)
	})

	test('preserves the plaintext BAP ID used by current account backups', () => {
		const decoded = decodeBapAccountBackup({
			wif: MEMBER_VECTOR.wif,
			id: 'Go8vCHAa4S6AhXKTABGpANiz35J',
		})

		expect(decoded.identityKey).toBe('Go8vCHAa4S6AhXKTABGpANiz35J')
		expect(decoded.rootKey.toWif()).toBe(MEMBER_VECTOR.wif)
	})
})
