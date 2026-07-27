import { createContext, type OneSatContext } from '@1sat/actions'
import { OneSatServices } from '@1sat/client'
import { useWallet } from '@1sat/react'
import { useMemo } from 'react'
import {
	ADMIN_ORIGINATOR,
	DAPP_ORIGINATOR,
} from '../localCwi/constants'
import { useLocalCwi } from '../localCwi/LocalCwiHost'
import { withOriginator } from '../localCwi/withOriginator'

const services = new OneSatServices('main')

/**
 * OneSatContext for actions.
 *
 * - Local CWI on → use gated WPM directly with bound originator
 *   (admin = silent apply; dApp = prompt). Avoids WalletClient overwriting originator.
 * - Local CWI off → connected extension wallet; always dApp-style isBaseWallet:false.
 */
export function useOneSatContext(): OneSatContext | null {
	const { wallet, status } = useWallet()
	const { localEnabled, gatedWallet, adminOriginator, status: localStatus } =
		useLocalCwi()

	return useMemo(() => {
		if (localEnabled && localStatus === 'ready' && gatedWallet) {
			const originator = adminOriginator ? ADMIN_ORIGINATOR : DAPP_ORIGINATOR
			return createContext(withOriginator(gatedWallet, originator), {
				chain: 'main',
				services,
				isBaseWallet: false,
			})
		}

		if (status !== 'connected' || !wallet) return null
		return createContext(wallet, {
			chain: 'main',
			services,
			isBaseWallet: false,
		})
	}, [
		localEnabled,
		localStatus,
		gatedWallet,
		adminOriginator,
		wallet,
		status,
	])
}
