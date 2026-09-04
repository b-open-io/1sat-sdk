import { WalletProvider, useWallet } from '@1sat/react'
import { Header } from './components/Header'
import { WalletInfo } from './components/WalletInfo'
import { SendBsv } from './components/SendBsv'
import { SendOrdinals } from './components/SendOrdinals'
import { TransferToken } from './components/TransferToken'
import { BurnPromptTest } from './components/BurnPromptTest'
import { Inscribe } from './components/Inscribe'
import { Listings } from './components/Listings'
import { SignMessage } from './components/SignMessage'
import { BapProfile } from './components/BapProfile'
import { LockBsv } from './components/LockBsv'
import { SendMnee } from './components/SendMnee'
import { MneeBalance } from './components/MneeBalance'
import { MneeHistory } from './components/MneeHistory'
import { OrdinalsList } from './components/OrdinalsList'
import { TokensList } from './components/TokensList'
import { UtxosList } from './components/UtxosList'
import { OpnsPanel } from './components/OpnsPanel'
import { DepositSync } from './components/DepositSync'
import { MigrateBaskets } from './components/MigrateBaskets'
import { EventLog } from './components/EventLog'
import { LogProvider } from './components/LogContext'
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
					<MigrateBaskets />
					<OpnsPanel />
					<SendBsv />
					<SendMnee />
					<Inscribe />
					<SendOrdinals />
					<TransferToken />
					<BurnPromptTest />
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
