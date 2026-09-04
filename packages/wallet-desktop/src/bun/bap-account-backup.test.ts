import { describe, expect, test } from 'bun:test'
import { decodeBapAccountBackup } from './bap-account-backup'

// Exported by bsv-bap 0.1.24 MemberID.exportForBackup and verified by
// MemberID.fromBackup. The member key is private scalar 2 with counter 3.
const MEMBER_VECTOR = {
	wif: 'KwDiBf89QgGbjEhKnhXJuH7LrciVrZi3qYjgd9M7rFU74NMTptX4',
	id: 'QklFMQPbYgBIG6NByG4zmcr62x6xXmaH7CnAZk1dtLIPMet8v/Fb2SqIPkGndkXrIfmGZv8C/x7R5UfilU7SfCicDukhfdsNe6EK3jBhUMCh7dy5XQsNwY4GLsxQtg9gzQDkKuKh/TKhZV8/Um3vHKZrTFUWB3pnnAcetDESxlwvTaoc9Zn0+hNj7qYC7zWvazrKR3kziQxdZoIG9RzgMNhDI0QyCKfDiRDP6CC66tZZFp/Ju5EELzJ1aCmSEN5dxbkSMSaNaE+haPKaRmttMOOl1aqp3UGvP/DvqadQhJ2A/vBIaFpAN2jrgUSzeHW4GnrqdzJgXGuzAgtT960xANkwgse5MKzeJEJB3mp7BHLiojcKtHBarKWCCFY16cKtpioDSO8+Mgmp/VEvpJjPuE1rxKyadvHObzVtJIqewpVvALxtF69Tq+nPyHdnw8OEd4Xg2g8=',
}

// Exported and restored by bsv-bap 0.1.20 MemberID. This format has no
// rotation counter and records the member private key's direct address.
const LEGACY_MEMBER_VECTOR = {
	wif: 'KwDiBf89QgGbjEhKnhXJuH7LrciVrZi3qYjgd9M7rFU74NMTptX4',
	id: 'QklFMQPbYgBIG6NByG4zmcr62x6xXmaH7CnAZk1dtLIPMet8v4GwSCMC0TxLJ4J56aI3z4/xtwUZolha3QshG9KhQAinwutr+Wc6rPMFHYIzm1lvz8dze5eJ5OBo0f+g66TpEpIFuphs0ILBJeBHNbCgoGksveooQWNsukg0/W2LJcRlXt6U9zYf6dSX9lIPhFyT/Ounj9LYl6zrumIvy5tKRy4W/a74MIKqLiWEW/1pftd4gFBMJpqfP/IaL6gkEa7m/oazsVIXgZKUqBpjGy1OENI9VDH+kQP1eOvQURRHmBwHwLfTvmV6Mp2iq/42B45Uzkw3Pi/1K2vEHWMFthsZkkoL5mZDhwWRcJ76QYmKXxcEYeCrogODCG4go4C9jah9CoSIAbIcLWViIJ22Ws75F15/BR1iL28ezwpjZTi+5MuQNA==',
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

	test('recovers an upstream 0.1.20 member export without a counter', () => {
		const decoded = decodeBapAccountBackup(LEGACY_MEMBER_VECTOR)

		expect(decoded.identityKey).toBe('Go8vCHAa4S6AhXKTABGpANiz35J')
		expect(decoded.rootKey.toWif()).toBe(LEGACY_MEMBER_VECTOR.wif)
		expect(decoded.rootKey.toPublicKey().toAddress()).toBe(
			'1cMh228HTCiwS8ZsaakH8A8wze1JR5ZsP',
		)
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
