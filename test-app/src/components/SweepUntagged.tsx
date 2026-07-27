import { signP2PKHInput } from '@1sat/actions'
import { BSV21 } from '@1sat/templates'
import { P2PKH, Transaction } from '@bsv/sdk'
import { useState } from 'react'
import { button, buttonDisabled, card, errorText, heading, input, label, successText } from './styles'
import { useLog } from './LogContext'
import { useOneSatContext } from './useActions'

/**
 * Move a BSV21 output that carries no `bsv21:` tag, so the tag-based selection
 * in `sendBsv21` cannot find it. Takes the outpoint directly and rebuilds the
 * transfer from the token id, amount and destination.
 */
export function SweepUntagged() {
	const ctx = useOneSatContext()
	const { log } = useLog()
	const [outpoint, setOutpoint] = useState('')
	const [tokenId, setTokenId] = useState('')
	const [amount, setAmount] = useState('')
	const [to, setTo] = useState('')
	const [feeAddress, setFeeAddress] = useState('')
	const [loading, setLoading] = useState(false)
	const [result, setResult] = useState<string | null>(null)
	const [error, setError] = useState<string | null>(null)

	// Token id + amount only apply to BSV21. Leave them blank to move a plain
	// 1-sat output (an ordinal) with a bare P2PKH.
	const isToken = !!tokenId
	const disabled =
		!ctx || loading || !outpoint || !to || (isToken && !amount)

	async function handleSweep() {
		if (!ctx || disabled) return
		setLoading(true)
		setResult(null)
		setError(null)
		log('info', `sweep untagged: ${outpoint}`)

		try {
			// The row is untagged but still ours — read its derivation from
			// customInstructions so the input can be unlocked.
			const listed = await ctx.wallet.listOutputs({
				basket: isToken ? 'p 1sat bsv21' : 'p 1sat ordinals',
				includeCustomInstructions: true,
				include: 'entire transactions',
				limit: 50,
			})
			const row = listed.outputs.find((o) => o.outpoint === outpoint)
			if (!row) throw new Error('outpoint not found in basket')
			const ci = JSON.parse(row.customInstructions ?? '{}')
			if (!ci.keyID) throw new Error('no keyID in customInstructions')

			// BSV21 needs the envelope wrapping a P2PKH — an inscription alone is
			// not spendable by the recipient. A plain ordinal is already inscribed,
			// so moving it is just the P2PKH.
			const lockingScript = isToken
				? BSV21.transfer(tokenId, BigInt(amount)).lock(new P2PKH().lock(to)).toHex()
				: new P2PKH().lock(to).toHex()

			const outputs = [
				{
					lockingScript,
					satoshis: 1,
					outputDescription: isToken ? `Send ${amount} tokens` : 'Send ordinal',
				},
			]
			if (isToken && feeAddress) {
				outputs.push({
					lockingScript: new P2PKH().lock(feeAddress).toHex(),
					satoshis: 1000,
					outputDescription: 'Overlay processing fee',
				})
			}

			const created = await ctx.wallet.createAction({
				description: 'Sweep untagged tokens',
				inputBEEF: listed.BEEF,
				inputs: [
					{
						outpoint,
						inputDescription: 'Untagged token input',
						unlockingScriptLength: 108,
					},
				],
				outputs,
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
			log('success', `sweep txid: ${signed.txid}`)
		} catch (err: unknown) {
			const msg = err instanceof Error ? err.message : String(err)
			setError(msg)
			log('error', `sweep failed: ${msg}`)
		} finally {
			setLoading(false)
		}
	}

	return (
		<div style={card}>
			<div style={heading}>Sweep Untagged BSV21</div>
			<label style={label}>Outpoint</label>
			<input style={input} placeholder="txid.vout" value={outpoint} onChange={(e) => setOutpoint(e.target.value)} />
			<label style={label}>Token ID</label>
			<input style={input} placeholder="txid_vout" value={tokenId} onChange={(e) => setTokenId(e.target.value)} />
			<label style={label}>Amount</label>
			<input style={input} placeholder="3" value={amount} onChange={(e) => setAmount(e.target.value)} />
			<label style={label}>Destination</label>
			<input style={input} placeholder="1A1zP1..." value={to} onChange={(e) => setTo(e.target.value)} />
			<label style={label}>Overlay fee address (optional)</label>
			<input style={input} placeholder="fee_address" value={feeAddress} onChange={(e) => setFeeAddress(e.target.value)} />
			<button style={disabled ? buttonDisabled : button} disabled={disabled} onClick={handleSweep}>
				Sweep Tokens
			</button>
			{result && <div style={successText}>TXID: {result}</div>}
			{error && <div style={errorText}>{error}</div>}
		</div>
	)
}
