import { describe, expect, test } from 'bun:test'
import type { StorageProvider, Wallet } from '@bsv/wallet-toolbox'
import {
	STORAGE_MAX_RESPONSE_BYTES,
	createStorageServer,
} from '../src/createStorageServer'

describe('createStorageServer', () => {
	test('raises the reply limit to 15 MiB, under what clients accept', () => {
		const server = createStorageServer({
			storage: {} as unknown as StorageProvider,
			wallet: { chain: 'test' } as unknown as Wallet,
			listen: { port: 0 },
		})
		const limits = server as unknown as { maxRpcResponseBytes: number }
		expect(STORAGE_MAX_RESPONSE_BYTES).toBe(15 * 1024 * 1024)
		expect(limits.maxRpcResponseBytes).toBe(STORAGE_MAX_RESPONSE_BYTES)
		// @bsv/sdk SimplifiedFetchTransport's default response cap.
		expect(STORAGE_MAX_RESPONSE_BYTES).toBeLessThan(16 * 1024 * 1024)
	})

	test("an operator's environment setting still wins", () => {
		const before = process.env.WALLET_STORAGE_RPC_MAX_RESPONSE_BYTES
		process.env.WALLET_STORAGE_RPC_MAX_RESPONSE_BYTES = '1048576'
		try {
			const server = createStorageServer({
				storage: {} as unknown as StorageProvider,
				wallet: { chain: 'test' } as unknown as Wallet,
				listen: { port: 0 },
			})
			const limits = server as unknown as { maxRpcResponseBytes: number }
			expect(limits.maxRpcResponseBytes).toBe(1_048_576)
		} finally {
			if (before === undefined)
				Reflect.deleteProperty(
					process.env,
					'WALLET_STORAGE_RPC_MAX_RESPONSE_BYTES',
				)
			else process.env.WALLET_STORAGE_RPC_MAX_RESPONSE_BYTES = before
		}
	})
})
