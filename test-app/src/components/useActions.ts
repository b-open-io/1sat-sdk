import { useWallet } from '@1sat/react'
import { createContext, type OneSatContext } from '@1sat/actions'
import { OneSatServices } from '@1sat/client'
import { useMemo } from 'react'

const services = new OneSatServices('main')

/**
 * Hook that creates an OneSatContext from the connected wallet.
 * This context is passed to all @1sat/actions execute() calls.
 */
export function useOneSatContext(): OneSatContext | null {
  const { wallet, status } = useWallet()

  return useMemo(() => {
    if (status !== 'connected' || !wallet) return null
    return createContext(wallet, { chain: 'main', services })
  }, [wallet, status])
}
