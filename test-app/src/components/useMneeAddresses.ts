import { type AddressDerivation, deriveDepositAddresses } from '@1sat/actions'
import { useEffect, useState } from 'react'
import { useOneSatContext } from './useActions'

const DEPOSIT_ADDRESS_COUNT = 5

/**
 * Derives the default 1sat deposit addresses for MNEE operations.
 * Uses the SDK's default prefix so the wallet and the dApp resolve to
 * the same address set under a shared identity key.
 */
export function useMneeAddresses() {
	const ctx = useOneSatContext()
	const [addresses, setAddresses] = useState<string[]>([])
	const [derivations, setDerivations] = useState<AddressDerivation[]>([])

	useEffect(() => {
		if (!ctx) return
		deriveDepositAddresses
			.execute(ctx, {
				startIndex: 0,
				count: DEPOSIT_ADDRESS_COUNT,
			})
			.then((res) => {
				setDerivations(res.derivations)
				setAddresses(res.derivations.map((d) => d.address))
			})
			.catch(() => {})
	}, [ctx])

	return { addresses, derivations }
}
