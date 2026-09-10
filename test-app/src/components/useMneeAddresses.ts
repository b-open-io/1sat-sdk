import {
  deriveDepositAddresses,
  LEGACY_ONESAT_PROTOCOL,
  ONESAT_PROTOCOL,
  type KeyDerivation,
} from '@1sat/actions'
import { useEffect, useState } from 'react'
import { useOneSatContext } from './useActions'

const DEPOSIT_ADDRESS_COUNT = 5

// MNEE funds can live on addresses derived under the current protocol or the
// legacy `p 1sat` protocol (pre-rename). Cover both so balance/send/history see
// the full balance and send can sign inputs from either set.
const MNEE_PROTOCOLS = [ONESAT_PROTOCOL, LEGACY_ONESAT_PROTOCOL]

/**
 * Builds the source key set for MNEE operations across every protocol that may
 * hold funds. `derivations` (protocolID + keyID) drive send + balance; the
 * derived `addresses` drive history/UTXO queries that are still address-keyed.
 */
export function useMneeAddresses() {
  const ctx = useOneSatContext()
  const [addresses, setAddresses] = useState<string[]>([])
  const [derivations, setDerivations] = useState<KeyDerivation[]>([])

  useEffect(() => {
    if (!ctx) return
    Promise.all(
      MNEE_PROTOCOLS.map(protocolID =>
        deriveDepositAddresses.execute(ctx, {
          startIndex: 0,
          count: DEPOSIT_ADDRESS_COUNT,
          protocolID,
        }),
      ),
    )
      .then(results => {
        setAddresses(results.flatMap(r => r.derivations.map(d => d.address)))
        setDerivations(
          results.flatMap((r, i) =>
            r.derivations.map(d => ({
              protocolID: MNEE_PROTOCOLS[i],
              keyID: `${d.derivationPrefix} ${d.derivationSuffix}`,
            })),
          ),
        )
      })
      .catch(() => {})
  }, [ctx])

  return { addresses, derivations }
}
