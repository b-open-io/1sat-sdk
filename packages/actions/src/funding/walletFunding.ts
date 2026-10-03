import {
	Beef,
	type CreateActionArgs,
	type CreateActionOutput,
	LivePolicy,
	LockingScript,
	Transaction,
	UnlockingScript,
	type WalletProtocol,
} from '@bsv/sdk'
import { P1SAT_PROTOCOL } from '../constants.js'
import type { OneSatContext } from '../types.js'
import { executeTrackedAction } from '../utils/createTrackedAction.js'
import { resolveDestination } from '../utils/resolveDestination.js'
import { signP2PKHInput } from '../utils/signP2PKH.js'
import type { FundingProvider, FundingResult } from './index.js'

/** The SDK's fee model interface (not exported by `@bsv/sdk` by name). */
type FeeModel = Exclude<Parameters<Transaction['fee']>[0], number | undefined>

/** Basket the wallet files side-door funding UTXOs into. */
export const FUNDING_BASKET = 'funding'

/** P2PKH unlocking script length used for fee sizing (sig + pubkey pushes). */
const P2PKH_UNLOCK_LENGTH = 108

export interface WalletFundingProviderOptions {
	/** Fee model for the target transaction. Default: the SDK's `LivePolicy`. */
	feeModel?: FeeModel
	/** Basket for the funding UTXO. Default {@link FUNDING_BASKET}. */
	basket?: string
}

/**
 * A {@link FundingProvider} that pays from the caller's own wallet through a
 * side door, so the target transaction can be internalized afterwards with
 * tags that depend on its txid.
 *
 * 1. `createAction` one P2PKH funding UTXO to a wallet-derived key, sized to
 *    the target's outputs plus its fee (normal broadcast), filed in
 *    {@link FUNDING_BASKET} with the derivation in customInstructions.
 * 2. Build the target transaction: that UTXO as its only input, the caller's
 *    outputs in the caller's order, signed with `getPublicKey` /
 *    `createSignature` for the stored derivation. The UTXO is sized exactly,
 *    so there is no change output.
 * 3. Broadcast it through `ctx.services.postBeef`.
 * 4. Return `{ txid, tx: AtomicBEEF }`.
 *
 * Caller-supplied inputs are not supported: they could not be signed over a
 * transaction this provider builds.
 */
export function createWalletFundingProvider(
	ctx: OneSatContext,
	options: WalletFundingProviderOptions = {},
): FundingProvider {
	const feeModel = options.feeModel ?? LivePolicy.getInstance()
	const basket = options.basket ?? FUNDING_BASKET

	return {
		async fund(args: CreateActionArgs): Promise<FundingResult> {
			if (args.inputs?.length) {
				throw new Error('wallet-funding-inputs-unsupported')
			}
			const services = ctx.services
			if (!services) throw new Error('services-required')
			const outputs = args.outputs ?? []

			const funding = await resolveDestination(ctx, undefined, {
				protocolID: P1SAT_PROTOCOL,
				keyIDPrefix: 'funding',
			})
			const derivation = funding.customInstructions
			if (!derivation) throw new Error('funding-derivation-missing')
			const unlock = walletP2PKHUnlock(
				ctx,
				derivation.protocolID,
				derivation.keyID,
			)

			// Size the fee on the target's final shape, before the input exists.
			const draft = targetTransaction(outputs, unlock, {
				sourceTXID: '00'.repeat(32),
				sourceOutputIndex: 0,
			})
			const fee = await feeModel.computeFee(draft)
			const fundingSats = outputs.reduce((sum, o) => sum + o.satoshis, 0) + fee

			const funded = await executeTrackedAction(ctx.wallet, {
				description: 'Fund side-door transaction',
				outputs: [
					{
						lockingScript: funding.lockingScript.toHex(),
						satoshis: fundingSats,
						outputDescription: 'Side-door funding',
						basket,
						customInstructions: JSON.stringify(derivation),
					},
				],
				options: { randomizeOutputs: false },
			})
			if (funded.error) throw new Error(funded.error)
			if (!funded.tx) throw new Error('funding-no-tx')
			const fundingTx = Transaction.fromAtomicBEEF(funded.tx)

			const tx = targetTransaction(outputs, unlock, {
				sourceTransaction: fundingTx,
				sourceOutputIndex: 0,
			})
			await tx.sign()

			const txid = tx.id('hex')
			const beef = tx.toAtomicBEEF()
			const [result] = await services.postBeef(Beef.fromBinary(beef), [txid])
			if (result?.status !== 'success') {
				throw new Error(
					`funding-broadcast-failed: ${result?.error?.message ?? 'no result'}`,
				)
			}
			return { txid, tx: beef }
		},
	}
}

function targetTransaction(
	outputs: CreateActionOutput[],
	unlock: ReturnType<typeof walletP2PKHUnlock>,
	source:
		| { sourceTXID: string; sourceOutputIndex: number }
		| { sourceTransaction: Transaction; sourceOutputIndex: number },
): Transaction {
	const tx = new Transaction()
	tx.addInput({
		...source,
		unlockingScriptTemplate: unlock,
		sequence: 0xffffffff,
	})
	for (const o of outputs) {
		tx.addOutput({
			lockingScript: LockingScript.fromHex(o.lockingScript),
			satoshis: o.satoshis,
		})
	}
	return tx
}

/** Unlocking template over {@link signP2PKHInput} (wallet-held derived key). */
function walletP2PKHUnlock(
	ctx: OneSatContext,
	protocolID: WalletProtocol,
	keyID: string,
) {
	return {
		sign: async (tx: Transaction, inputIndex: number) => {
			const hex = await signP2PKHInput(ctx, tx, inputIndex, protocolID, keyID)
			if (typeof hex !== 'string') throw new Error(hex.error)
			return UnlockingScript.fromHex(hex)
		},
		estimateLength: async () => P2PKH_UNLOCK_LENGTH,
	}
}
