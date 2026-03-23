import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useCallback, useEffect, useState } from 'react'
import { useWallet } from '../../hooks/use-wallet'
import { ReceiveAddress } from '@/components/blocks/receive-address'
import { SendBsv, type SendBsvParams, type SendBsvResult } from '@/components/blocks/send-bsv'
import QRCode from 'qrcode'

function formatBsv(satoshis: number): string {
	return (satoshis / 1e8).toFixed(8)
}

export function WalletPanel() {
	const { balance, sendBsv, getReceiveInfo } = useWallet()

	const [receiveAddress, setReceiveAddress] = useState<string | null>(null)

	useEffect(() => {
		getReceiveInfo().then(
			(info) => setReceiveAddress(info.address),
			(err) => console.error('Failed to get receive info:', err),
		)
	}, [getReceiveInfo])

	const handleSend = useCallback(
		async (params: SendBsvParams): Promise<SendBsvResult> => {
			try {
				const result = await sendBsv(params.address, params.satoshis)
				return { txid: result.txid }
			} catch (err) {
				return {
					error:
						err instanceof Error
							? err.message
							: 'Failed to send BSV',
				}
			}
		},
		[sendBsv],
	)

	const renderQr = useCallback(
		(address: string) => {
			const canvasRef = (el: HTMLCanvasElement | null) => {
				if (!el || !address) return
				QRCode.toCanvas(el, address, {
					width: 160,
					margin: 2,
					color: { dark: '#ffffff', light: '#000000' },
					errorCorrectionLevel: 'M',
				}).catch(() => {})
			}
			return (
				<div className="inline-flex border border-border bg-black p-2">
					<canvas ref={canvasRef} />
				</div>
			)
		},
		[],
	)

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
						<div className="pt-4">
							<ReceiveAddress
								address={receiveAddress}
								renderQr={renderQr}
								variant="default"
								qrSize={160}
							/>
						</div>
					</TabsContent>

					<TabsContent value="send">
						<div className="pt-4 flex justify-center">
							<SendBsv
								onSend={handleSend}
								variant="default"
								dialogSize="compact"
								onSuccess={(result) => {
									console.log('Sent BSV:', result.txid)
								}}
							/>
						</div>
					</TabsContent>
				</Tabs>
			</div>
		</aside>
	)
}
