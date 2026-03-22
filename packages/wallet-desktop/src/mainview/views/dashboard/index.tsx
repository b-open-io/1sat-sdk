import { Button } from '@/components/ui/button'
import { Card, CardContent, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useCallback, useEffect, useState } from 'react'
import { BalanceCard } from '../../components/balance-card'
import { QrCode } from '../../components/qr-code'
import { SyncTerminal } from '../../components/sync-terminal'
import { useSyncEvents } from '../../hooks/use-sync-events'
import { useWallet } from '../../hooks/use-wallet'
import { HistoryView } from '../history/index'
import { InscribeView } from '../inscribe/index'
import { OrdinalsView } from '../ordinals/index'
import { SettingsView } from '../settings/index'
import { TokensView } from '../tokens/index'

const TABS = [
	{ id: 'overview', label: 'Overview' },
	{ id: 'ordinals', label: 'Ordinals' },
	{ id: 'tokens', label: 'Tokens' },
	{ id: 'history', label: 'History' },
	{ id: 'inscribe', label: 'Inscribe' },
	{ id: 'settings', label: 'Settings' },
] as const

type Tab = (typeof TABS)[number]['id']

function OverviewTab() {
	const { balance, sendBsv, getReceiveInfo } = useWallet()
	const { events } = useSyncEvents()

	const [receiveAddress, setReceiveAddress] = useState('')
	const [sendAddress, setSendAddress] = useState('')
	const [sendAmount, setSendAmount] = useState('')
	const [sendError, setSendError] = useState('')
	const [sendSuccess, setSendSuccess] = useState('')
	const [sending, setSending] = useState(false)

	useEffect(() => {
		getReceiveInfo().then(
			(info) => setReceiveAddress(info.address),
			(err) => console.error('Failed to get receive info:', err),
		)
	}, [getReceiveInfo])

	const handleSend = useCallback(async () => {
		setSendError('')
		setSendSuccess('')

		if (!sendAddress) {
			setSendError('Address is required')
			return
		}

		const amount = Number.parseFloat(sendAmount)
		if (Number.isNaN(amount) || amount <= 0) {
			setSendError('Invalid amount')
			return
		}

		// Convert BSV to satoshis
		const satoshis = Math.round(amount * 1e8)

		setSending(true)
		try {
			const result = await sendBsv(sendAddress, satoshis)
			setSendSuccess(`Sent! txid: ${result.txid}`)
			setSendAddress('')
			setSendAmount('')
		} catch (err) {
			setSendError(String(err))
		} finally {
			setSending(false)
		}
	}, [sendAddress, sendAmount, sendBsv])

	return (
		<div className="p-6 space-y-6">
			{/* Balance */}
			<BalanceCard
				confirmed={balance.confirmed}
				unconfirmed={balance.unconfirmed}
			/>

			{/* Receive */}
			<Card>
				<CardContent className="p-6">
					<CardTitle className="mb-4">Receive</CardTitle>
					{receiveAddress ? (
						<div className="flex flex-col items-center gap-4">
							<QrCode value={receiveAddress} size={180} />
							<Input
								readOnly
								value={receiveAddress}
								className="select-all"
								onClick={(e) => (e.target as HTMLInputElement).select()}
							/>
						</div>
					) : (
						<div className="text-sm text-muted-foreground">
							Loading address...
						</div>
					)}
				</CardContent>
			</Card>

			{/* Send */}
			<Card>
				<CardContent className="p-6">
					<CardTitle className="mb-4">Send</CardTitle>
					<div className="space-y-3">
						<Input
							value={sendAddress}
							onChange={(e) => setSendAddress(e.target.value)}
							placeholder="Recipient address"
							spellCheck={false}
						/>
						<Input
							value={sendAmount}
							onChange={(e) => setSendAmount(e.target.value)}
							placeholder="Amount (BSV)"
							onKeyDown={(e) => {
								if (e.key === 'Enter') handleSend()
							}}
						/>

						{sendError && (
							<div className="p-3 border border-destructive text-destructive text-sm font-mono">
								{sendError}
							</div>
						)}

						{sendSuccess && (
							<div className="p-3 border border-primary/50 text-primary text-sm font-mono break-all">
								{sendSuccess}
							</div>
						)}

						<Button
							className="w-full"
							size="lg"
							disabled={sending}
							onClick={handleSend}
						>
							{sending ? 'Sending...' : 'Send BSV'}
						</Button>
					</div>
				</CardContent>
			</Card>

			{/* Sync Terminal */}
			<SyncTerminal events={events} />
		</div>
	)
}

export function Dashboard() {
	const { lockWallet } = useWallet()
	const [activeTab, setActiveTab] = useState<Tab>('overview')

	const handleLock = useCallback(async () => {
		await lockWallet()
	}, [lockWallet])

	return (
		<div className="min-h-screen flex flex-col">
			{/* Header */}
			<div className="flex items-center justify-between px-6 py-4 border-b border-border">
				<h1 className="text-lg font-bold text-foreground">1Sat Wallet</h1>
				<Button variant="outline" size="sm" onClick={handleLock}>
					Lock
				</Button>
			</div>

			{/* Tabs */}
			<Tabs
				value={activeTab}
				onValueChange={(v) => setActiveTab(v as Tab)}
				className="flex-1 flex flex-col"
			>
				<TabsList>
					{TABS.map((tab) => (
						<TabsTrigger key={tab.id} value={tab.id}>
							{tab.label}
						</TabsTrigger>
					))}
				</TabsList>

				<div className="flex-1 overflow-y-auto">
					<TabsContent value="overview">
						<OverviewTab />
					</TabsContent>
					<TabsContent value="ordinals">
						<OrdinalsView />
					</TabsContent>
					<TabsContent value="tokens">
						<TokensView />
					</TabsContent>
					<TabsContent value="history">
						<HistoryView />
					</TabsContent>
					<TabsContent value="inscribe">
						<InscribeView />
					</TabsContent>
					<TabsContent value="settings">
						<SettingsView />
					</TabsContent>
				</div>
			</Tabs>
		</div>
	)
}
