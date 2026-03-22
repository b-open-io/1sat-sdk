import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Copy } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useWallet } from '../../hooks/use-wallet'
import { QrCode } from '../qr-code'

function formatBsv(satoshis: number): string {
	return (satoshis / 1e8).toFixed(8)
}

function truncateAddress(address: string): string {
	if (address.length <= 16) return address
	return `${address.slice(0, 8)}...${address.slice(-8)}`
}

export function WalletPanel() {
	const { balance, sendBsv, getReceiveInfo } = useWallet()

	const [receiveAddress, setReceiveAddress] = useState('')
	const [sendAddress, setSendAddress] = useState('')
	const [sendAmount, setSendAmount] = useState('')
	const [sendError, setSendError] = useState('')
	const [sendSuccess, setSendSuccess] = useState('')
	const [sending, setSending] = useState(false)
	const [copied, setCopied] = useState(false)

	useEffect(() => {
		getReceiveInfo().then(
			(info) => setReceiveAddress(info.address),
			(err) => console.error('Failed to get receive info:', err),
		)
	}, [getReceiveInfo])

	const handleCopy = useCallback(async () => {
		if (!receiveAddress) return
		await navigator.clipboard.writeText(receiveAddress)
		setCopied(true)
		setTimeout(() => setCopied(false), 2000)
	}, [receiveAddress])

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
		<aside className="flex-none w-80 border-l border-border bg-card flex flex-col overflow-y-auto">
			{/* Balance */}
			<div className="p-5 border-b border-border">
				<div className="text-xs font-mono uppercase tracking-wider text-muted-foreground mb-2">
					Balance
				</div>
				<div className="text-2xl font-mono text-foreground tracking-tight">
					{formatBsv(balance.confirmed)}{' '}
					<span className="text-xs text-muted-foreground">BSV</span>
				</div>
				{balance.unconfirmed !== 0 && (
					<div className="mt-1 text-xs font-mono text-muted-foreground">
						{balance.unconfirmed > 0 ? '+' : ''}
						{formatBsv(balance.unconfirmed)} unconfirmed
					</div>
				)}
			</div>

			{/* Receive / Send Tabs */}
			<div className="flex-1 p-4">
				<Tabs defaultValue="receive" className="w-full">
					<TabsList className="w-full">
						<TabsTrigger value="receive" className="flex-1">
							Receive
						</TabsTrigger>
						<TabsTrigger value="send" className="flex-1">
							Send
						</TabsTrigger>
					</TabsList>

					<TabsContent value="receive">
						<div className="flex flex-col items-center gap-4 pt-4">
							{receiveAddress ? (
								<>
									<QrCode value={receiveAddress} size={160} />
									<button
										type="button"
										onClick={handleCopy}
										className="flex items-center gap-2 text-xs font-mono text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
									>
										<span>{truncateAddress(receiveAddress)}</span>
										<Copy size={12} />
									</button>
									{copied && (
										<span className="text-xs text-primary">
											Copied to clipboard
										</span>
									)}
								</>
							) : (
								<div className="text-sm text-muted-foreground py-4">
									Loading address...
								</div>
							)}
						</div>
					</TabsContent>

					<TabsContent value="send">
						<div className="space-y-3 pt-4">
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
								<div className="p-3 border border-destructive text-destructive text-xs font-mono">
									{sendError}
								</div>
							)}

							{sendSuccess && (
								<div className="p-3 border border-primary/50 text-primary text-xs font-mono break-all">
									{sendSuccess}
								</div>
							)}

							<Button
								className="w-full"
								disabled={sending}
								onClick={handleSend}
							>
								{sending ? 'Sending...' : 'Send BSV'}
							</Button>
						</div>
					</TabsContent>
				</Tabs>
			</div>
		</aside>
	)
}
