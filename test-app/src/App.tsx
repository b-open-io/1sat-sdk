import { useWallet, WalletProvider } from '@1sat/react'
import { BapProfile } from './components/BapProfile'
import { DepositSync } from './components/DepositSync'
import { EventLog } from './components/EventLog'
import { Header } from './components/Header'
import { Inscribe } from './components/Inscribe'
import { Listings } from './components/Listings'
import { LockBsv } from './components/LockBsv'
import { LogProvider } from './components/LogContext'
import { MneeBalance } from './components/MneeBalance'
import { MneeHistory } from './components/MneeHistory'
import { OpnsPanel } from './components/OpnsPanel'
import { OrdinalsList } from './components/OrdinalsList'
import { SendBsv } from './components/SendBsv'
import { SendMnee } from './components/SendMnee'
import { SendOrdinals } from './components/SendOrdinals'
import { SignMessage } from './components/SignMessage'
import { TokensList } from './components/TokensList'
import { TransferToken } from './components/TransferToken'
import { UtxosList } from './components/UtxosList'
import { WalletInfo } from './components/WalletInfo'
import { LocalCwiHost } from './localCwi/LocalCwiHost'

/** Keyed by identityKey so all child state resets on account switch */
function WalletContent() {
	const { identityKey } = useWallet()

	return (
		<div key={identityKey ?? 'disconnected'}>
			<WalletInfo />
			<div style={gridStyle}>
				<div style={colStyle}>
					<DepositSync />
					<OpnsPanel />
					<SendBsv />
					<SendMnee />
					<Inscribe />
					<SendOrdinals />
					<TransferToken />
					<Listings />
					<SignMessage />
					<BapProfile />
					<LockBsv />
				</div>
				<div style={colStyle}>
					<MneeBalance />
					<MneeHistory />
					<OrdinalsList />
					<TokensList />
					<UtxosList />
				</div>
			</div>
		</div>
	)
}

function App() {
	return (
		<LocalCwiHost>
			<WalletProvider autoReconnect>
				<LogProvider>
					<Header />
					<WalletContent />
					<EventLog />
				</LogProvider>
			</WalletProvider>
		</LocalCwiHost>
	)
}

const gridStyle: React.CSSProperties = {
	display: 'grid',
	gridTemplateColumns: '1fr 1fr',
	gap: '1.5rem',
	marginTop: '1.5rem',
}

const colStyle: React.CSSProperties = {
	display: 'flex',
	flexDirection: 'column',
	gap: '1.5rem',
}

export default App
