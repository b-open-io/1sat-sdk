import { deriveDepositAddresses, type AddressDerivation } from '@1sat/actions'
import { useEffect, useState } from 'react'
import { useOneSatContext } from './useActions'

const YOURS_PREFIX = 'yours'
const YOURS_ADDRESS_COUNT = 5

/**
 * Derives the 5 yours wallet BRC-29 addresses for MNEE operations.
 * Returns both the address strings and full derivations (for signing).
 */
export function useMneeAddresses() {
  const ctx = useOneSatContext()
  const [addresses, setAddresses] = useState<string[]>([])
  const [derivations, setDerivations] = useState<AddressDerivation[]>([])

  useEffect(() => {
    if (!ctx) return
    deriveDepositAddresses
      .execute(ctx, {
        prefix: YOURS_PREFIX,
        startIndex: 0,
        count: YOURS_ADDRESS_COUNT,
      })
      .then((res) => {
        setDerivations(res.derivations)
        setAddresses(res.derivations.map((d) => d.address))
      })
      .catch(() => {})
  }, [ctx])

  return { addresses, derivations }
}
