import type { OneSatServices } from '@1sat/client'
import { createWalletCore } from '@1sat/wallet'
import type { PrivateKey } from '@bsv/sdk'
import {
	Services,
	StorageClient,
	StorageProvider,
	Wallet,
	WalletStorageManager,
} from '@bsv/wallet-toolbox/out/src/index.client.js'

export interface RemoteWalletConfig {
	privateKey: PrivateKey | string
	chain: 'main' | 'test'
	feeModel?: { model: 'sat/kb'; value: number }
	activeRemote: string
	backups?: string[]
	connectionTimeout?: number
}

export interface RemoteWalletResult {
	wallet: Wallet
	services: OneSatServices
	destroy: () => Promise<void>
	storage: WalletStorageManager
	feeModel: { model: 'sat/kb'; value: number }
	setActiveStorage: (target: 'local' | string) => Promise<void>
	addRemote: (url: string) => Promise<void>
}

export async function createRemoteWallet(
	config: RemoteWalletConfig,
): Promise<RemoteWalletResult> {
	const core = await createWalletCore(config, undefined, {
		Services,
		StorageClient,
		StorageProvider,
		Wallet,
		WalletStorageManager,
	})

	return {
		wallet: core.wallet,
		services: core.services,
		destroy: core.destroy,
		storage: core.storage,
		feeModel: core.feeModel,
		setActiveStorage: core.setActiveStorage,
		addRemote: core.addRemote,
	}
}
