import { useCallback } from "react"
import { DeployTokenUI } from "./ui"
import {
  useDeployToken,
  type DeployTokenParams,
  type DeployTokenResult,
  type UseDeployTokenOptions,
} from "./use-deploy-token"

// ---------------------------------------------------------------------------
// Re-exports
// ---------------------------------------------------------------------------

export { DeployTokenUI, type DeployTokenUIProps, type DeployTokenFormState } from "./ui"
export {
  useDeployToken,
  type DeployTokenParams,
  type DeployTokenResult,
  type UseDeployTokenOptions,
  type UseDeployTokenReturn,
} from "./use-deploy-token"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DeployTokenProps {
  /** Callback that executes the on-chain deploy action */
  onDeploy: (params: DeployTokenParams) => Promise<DeployTokenResult>
  /** Callback on successful deployment */
  onSuccess?: (result: DeployTokenResult) => void
  /** Callback on error */
  onError?: (error: Error) => void
  /** Default form values */
  defaults?: UseDeployTokenOptions
  /** Optional CSS class name */
  className?: string
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Composed BSV21 token deploy block wiring the `useDeployToken` hook
 * to the `DeployTokenUI` presentation component.
 *
 * Pass an `onDeploy` handler that calls the underlying deploy action
 * (e.g. `deployBsv21Token` from `@1sat/core`) and return a result
 * containing `{ txid }` or `{ error }`.
 *
 * @example
 * ```tsx
 * import { DeployToken } from "@/components/blocks/deploy-token"
 * import { deployBsv21Token } from "@1sat/core"
 *
 * <DeployToken
 *   onDeploy={async (params) => {
 *     const tx = await deployBsv21Token({
 *       symbol: params.symbol,
 *       decimals: params.decimals,
 *       icon: { dataB64: params.iconBase64, contentType: params.iconContentType },
 *       initialDistribution: { address: myAddress, tokens: Number(params.maxSupply) },
 *       destinationAddress: myAddress,
 *       utxos: paymentUtxos,
 *     })
 *     return { txid: tx.id("hex") }
 *   }}
 *   onSuccess={(r) => console.log("Deployed:", r.txid)}
 * />
 * ```
 */
export function DeployToken({
  onDeploy,
  onSuccess,
  onError,
  defaults,
  className,
}: DeployTokenProps) {
  const token = useDeployToken(defaults)

  const handleDeploy = useCallback(() => {
    void token.deploy(async (params) => {
      const result = await onDeploy(params)

      if (result.error) {
        onError?.(new Error(result.error))
      } else {
        onSuccess?.(result)
      }

      return result
    })
  }, [token.deploy, onDeploy, onSuccess, onError])

  return (
    <DeployTokenUI
      form={token.form}
      onSymbolChange={token.setSymbol}
      onMaxSupplyChange={token.setMaxSupply}
      onDecimalsChange={token.setDecimals}
      onIconSelect={token.selectIcon}
      onIconRemove={token.removeIcon}
      onDeploy={handleDeploy}
      isDeploying={token.isDeploying}
      feeEstimate={token.feeEstimate}
      resultTxid={token.resultTxid}
      errorMessage={token.errorMessage}
      isValid={token.isValid}
      className={className}
    />
  )
}
