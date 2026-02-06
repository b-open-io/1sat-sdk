/**
 * React example using @1sat/react
 *
 * Install dependencies:
 *   bun add @1sat/react react react-dom
 */
import {
	ConnectButton,
	OneSatProvider,
	useBalance,
	useInscribe,
	useOneSatContext,
	useOrdinals,
} from '@1sat/react'
import { Utils } from '@bsv/sdk'
import { useState } from 'react'

const { toArray, toBase64 } = Utils

function WalletInfo() {
	const { isConnected, paymentAddress, ordinalAddress } = useOneSatContext()
	const { satoshis, isLoading: balanceLoading } = useBalance()
	const { ordinals, isLoading: ordinalsLoading } = useOrdinals(5)

	if (!isConnected) {
		return <p>Connect your wallet to get started</p>
	}

	return (
		<div>
			<h2>Wallet Info</h2>
			<p>
				<strong>Payment Address:</strong> {paymentAddress}
			</p>
			<p>
				<strong>Ordinal Address:</strong> {ordinalAddress}
			</p>

			<h3>Balance</h3>
			{balanceLoading ? <p>Loading...</p> : <p>{satoshis} satoshis</p>}

			<h3>Ordinals ({ordinals.length})</h3>
			{ordinalsLoading ? (
				<p>Loading...</p>
			) : (
				<ul>
					{ordinals.map((ord) => (
						<li key={ord.outpoint}>
							{ord.origin?.data?.insc?.file?.type ?? 'Unknown'} - {ord.outpoint}
						</li>
					))}
				</ul>
			)}
		</div>
	)
}

function InscribeForm() {
	const { isConnected } = useOneSatContext()
	const { inscribe, isLoading } = useInscribe()
	const [text, setText] = useState('')
	const [result, setResult] = useState<{ txid: string } | null>(null)

	if (!isConnected) return null

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault()
		if (!text.trim()) return

		try {
			const res = await inscribe({
				dataB64: toBase64(toArray(text, 'utf8')),
				contentType: 'text/plain',
			})
			setResult(res)
			setText('')
		} catch (err) {
			console.error('Inscription failed:', err)
		}
	}

	return (
		<div>
			<h2>Create Inscription</h2>
			<form onSubmit={handleSubmit}>
				<textarea
					value={text}
					onChange={(e) => setText(e.target.value)}
					placeholder="Enter text to inscribe..."
					rows={3}
					style={{ width: '100%', marginBottom: '1rem' }}
				/>
				<button type="submit" disabled={isLoading || !text.trim()}>
					{isLoading ? 'Inscribing...' : 'Inscribe'}
				</button>
			</form>

			{result && (
				<p>
					Inscribed! TXID: <code>{result.txid}</code>
				</p>
			)}
		</div>
	)
}

function App() {
	return (
		<OneSatProvider appName="React Example">
			<div style={{ maxWidth: 600, margin: '2rem auto', padding: '1rem' }}>
				<h1>1Sat SDK React Example</h1>

				<div style={{ marginBottom: '2rem' }}>
					<ConnectButton />
				</div>

				<WalletInfo />
				<InscribeForm />
			</div>
		</OneSatProvider>
	)
}

export default App
