import { signP2PKHInput } from '@1sat/actions'
import { P2PKH, Transaction } from '@bsv/sdk'
import { useState } from 'react'
import {
	button,
	buttonDisabled,
	card,
	errorText,
	heading,
	input,
	label,
	successText,
} from './styles'
import { useLog } from './LogContext'
import { useOneSatContext } from './useActions'

/**
 * Move an ordinal that carries no `id:` tag, so `sendOrdinals` cannot find it.
 *
 * Takes the outpoint directly. The satoshi is already inscribed, so the output
 * is a bare P2PKH — nothing to rebuild, no fee.
 */
export function SendUntaggedOrdinal() {
	const ctx = useOneSatContext()
	const { log } = useLog()
	const [outpoint, setOutpoint] = useState('')
	const [to, setTo] = useState('')
	const [loading, setLoading] = useState(false)
	const [result, setResult] = useState<string | null>(null)
	const [error, setError] = useState<string | null>(null)

	const disabled = !ctx || loading || !outpoint || !to

	async function handleSend() {
		if (!ctx || disabled) return
		setLoading(true)
		setResult(null)
		setError(null)
		log('info', `send untagged ordinal: ${outpoint}`)

		try {
			// Untagged but still ours — the derivation is in customInstructions.
			const listed = await ctx.wallet.listOutputs({
				basket: 'p 1sat ordinals',
				includeCustomInstructions: true,
				include: 'entire transactions',
				limit: 100,
			})
			const row = listed.outputs.find((o) => o.outpoint === outpoint)
			if (!row) throw new Error('outpoint not found in ordinals basket')
			const ci = JSON.parse(row.customInstructions ?? '{}')
			if (!ci.keyID) throw new Error('no keyID in customInstructions')

			const created = await ctx.wallet.createAction({
				description: 'Send untagged ordinal',
				inputBEEF: listed.BEEF,
				inputs: [
					{
						outpoint,
						inputDescription: 'Untagged ordinal',
						unlockingScriptLength: 108,
					},
				],
				outputs: [
					{
						lockingScript: new P2PKH().lock(to).toHex(),
						satoshis: 1,
						outputDescription: 'Send ordinal',
					},
				],
				options: { randomizeOutputs: false },
			})

			const signable = created.signableTransaction
			if (!signable) throw new Error('no signable transaction returned')

			const tx = Transaction.fromAtomicBEEF(signable.tx)
			const unlocking = await signP2PKHInput(
				ctx,
				tx,
				0,
				ci.protocolID,
				ci.keyID,
				ci.counterparty ?? 'self',
			)
			if (typeof unlocking !== 'string') throw new Error(unlocking.error)

			const signed = await ctx.wallet.signAction({
				reference: signable.reference,
				spends: { 0: { unlockingScript: unlocking } },
			})

			setResult(signed.txid ?? 'no txid')
			log('success', `send untagged ordinal txid: ${signed.txid}`)
		} catch (err: unknown) {
			const msg = err instanceof Error ? err.message : String(err)
			setError(msg)
			log('error', `send untagged ordinal failed: ${msg}`)
		} finally {
			setLoading(false)
		}
	}

	return (
		<div style={card}>
			<div style={heading}>Send Untagged Ordinal</div>
			<label style={label}>Outpoint</label>
			<input
				style={input}
				placeholder="ord txid.vout"
				value={outpoint}
				onChange={(e) => setOutpoint(e.target.value)}
			/>
			<label style={label}>Destination</label>
			<input
				style={input}
				placeholder="ord destination"
				value={to}
				onChange={(e) => setTo(e.target.value)}
			/>
			<button
				style={disabled ? buttonDisabled : button}
				disabled={disabled}
				onClick={handleSend}
			>
				Send Ordinal
			</button>
			{result && <div style={successText}>TXID: {result}</div>}
			{error && <div style={errorText}>{error}</div>}
		</div>
	)
}
