import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@/components/ui/select'
import { useCallback, useEffect, useState } from 'react'
import { rpc } from '../../rpc'

// ─── Constants (hoisted — rendering-hoist-jsx) ────────────────────────────────

// BSV mines ~6 blocks per hour
const BLOCKS_PER_HOUR = 6
const BLOCKS_PER_DAY = BLOCKS_PER_HOUR * 24

interface Duration {
	label: string
	value: string
	blocks: number
}

const DURATIONS: Duration[] = [
	{ label: '1 day', value: '1d', blocks: BLOCKS_PER_DAY },
	{ label: '1 week', value: '1w', blocks: BLOCKS_PER_DAY * 7 },
	{ label: '1 month', value: '1mo', blocks: BLOCKS_PER_DAY * 30 },
	{ label: '3 months', value: '3mo', blocks: BLOCKS_PER_DAY * 90 },
	{ label: '1 year', value: '1y', blocks: BLOCKS_PER_DAY * 365 },
]

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatSats(sats: number): string {
	if (sats === 0) return '0 sats'
	if (sats >= 100_000_000) {
		return `${(sats / 100_000_000).toFixed(8)} BSV`
	}
	return `${sats.toLocaleString()} sats`
}

function formatBlock(height: number): string {
	if (height === 0) return '—'
	return height.toLocaleString()
}

// ─── Stat card ────────────────────────────────────────────────────────────────

function StatCard({
	label,
	value,
	accent = false,
}: {
	label: string
	value: string
	accent?: boolean
}) {
	return (
		<div className="flex flex-col gap-1 border border-border px-4 py-3 flex-1">
			<span
				className="text-muted-foreground uppercase tracking-wider"
				style={{
					fontFamily: 'var(--font-mono)',
					fontSize: 10,
					letterSpacing: '0.1em',
				}}
			>
				{label}
			</span>
			<span
				className={accent ? 'text-primary' : 'text-foreground'}
				style={{
					fontFamily: 'var(--font-mono)',
					fontSize: 13,
					fontWeight: 600,
				}}
			>
				{value}
			</span>
		</div>
	)
}

// ─── Section header ───────────────────────────────────────────────────────────

function SectionHeader({ label }: { label: string }) {
	return (
		<div
			className="text-muted-foreground uppercase tracking-wider mb-3"
			style={{
				fontFamily: 'var(--font-mono)',
				fontSize: 10,
				letterSpacing: '0.1em',
			}}
		>
			{label}
		</div>
	)
}

// ─── LocksView ────────────────────────────────────────────────────────────────

export function LocksView() {
	const [lockData, setLockData] = useState<{
		totalLocked: number
		unlockable: number
		nextUnlock: number
	}>({ totalLocked: 0, unlockable: 0, nextUnlock: 0 })

	const [satoshis, setSatoshis] = useState('')
	const [duration, setDuration] = useState<string>(DURATIONS[1].value)
	const [locking, setLocking] = useState(false)
	const [unlocking, setUnlocking] = useState(false)
	const [error, setError] = useState<string | null>(null)

	useEffect(() => {
		rpc.request
			.getLockData()
			.then((data) => setLockData(data))
			.catch((err) => console.error('Failed to load lock data:', err))
	}, [])

	const handleLock = useCallback(
		async (e: React.FormEvent<HTMLFormElement>) => {
			e.preventDefault()
			setError(null)

			const sats = Number.parseInt(satoshis, 10)
			if (Number.isNaN(sats) || sats <= 0) {
				setError('Amount must be a positive number of satoshis')
				return
			}

			const selected = DURATIONS.find((d) => d.value === duration)
			if (!selected) {
				setError('Select a lock duration')
				return
			}

			// Compute future block height: approximate current tip + duration blocks
			// The backend should ideally resolve current tip; we use a relative offset
			// and let the wallet layer compute the absolute height.
			const until = selected.blocks

			setLocking(true)
			try {
				const result = await rpc.request.lockBsv({ satoshis: sats, until })
				if (result.error) {
					setError(result.error)
				} else {
					setSatoshis('')
					const data = await rpc.request.getLockData()
					setLockData(data)
				}
			} catch (err) {
				setError(err instanceof Error ? err.message : 'Lock failed')
			} finally {
				setLocking(false)
			}
		},
		[satoshis, duration],
	)

	const handleUnlock = useCallback(async () => {
		setError(null)
		setUnlocking(true)
		try {
			const result = await rpc.request.unlockBsv()
			if (result.error) {
				setError(result.error)
			} else {
				const data = await rpc.request.getLockData()
				setLockData(data)
			}
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Unlock failed')
		} finally {
			setUnlocking(false)
		}
	}, [])

	return (
		<div className="mx-auto w-full py-8 px-6" style={{ maxWidth: 800 }}>
			{/* Page title */}
			<h1
				className="text-foreground font-semibold mb-6"
				style={{
					fontFamily: 'var(--font-sans)',
					fontSize: 20,
					lineHeight: 1,
				}}
			>
				Time Locks
			</h1>

			{/* Stats row */}
			<div className="flex gap-3 mb-6">
				<StatCard
					label="Total Locked"
					value={formatSats(lockData.totalLocked)}
				/>
				<StatCard
					label="Unlockable Now"
					value={formatSats(lockData.unlockable)}
					accent={lockData.unlockable > 0}
				/>
				<StatCard
					label="Next Unlock"
					value={
						lockData.nextUnlock > 0
							? `Block ${formatBlock(lockData.nextUnlock)}`
							: '—'
					}
				/>
			</div>

			{/* Divider */}
			<div className="border-t border-border mb-6" />

			{/* Create lock section */}
			<div className="mb-6">
				<SectionHeader label="Create Lock" />

				<form onSubmit={handleLock} className="flex flex-col gap-4">
					<div className="flex gap-3">
						{/* Amount */}
						<div className="flex flex-col gap-1.5 flex-1">
							<label
								htmlFor="lock-amount"
								className="text-muted-foreground"
								style={{ fontFamily: 'var(--font-sans)', fontSize: 11 }}
							>
								Amount (sats)
							</label>
							<Input
								id="lock-amount"
								type="number"
								min={1}
								placeholder="10000"
								value={satoshis}
								onChange={(e) => setSatoshis(e.target.value)}
								disabled={locking}
								style={{ fontFamily: 'var(--font-mono)', fontSize: 13 }}
							/>
						</div>

						{/* Duration */}
						<div className="flex flex-col gap-1.5">
							<label
								htmlFor="lock-duration"
								className="text-muted-foreground"
								style={{ fontFamily: 'var(--font-sans)', fontSize: 11 }}
							>
								Duration
							</label>
							<Select
								value={duration}
								onValueChange={setDuration}
								disabled={locking}
							>
								<SelectTrigger
									id="lock-duration"
									className="w-36"
									style={{ fontFamily: 'var(--font-sans)', fontSize: 13 }}
								>
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{DURATIONS.map((d) => (
										<SelectItem key={d.value} value={d.value}>
											{d.label}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
					</div>

					{/* Validation error */}
					{error && (
						<p
							className="text-destructive"
							style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}
						>
							{error}
						</p>
					)}

					<Button
						type="submit"
						disabled={locking || !satoshis}
						className="w-full"
					>
						{locking ? 'Locking...' : 'Lock BSV'}
					</Button>
				</form>
			</div>

			{/* Unlock section — only shown when there are unlockable sats */}
			{lockData.unlockable > 0 && (
				<>
					<div className="border-t border-border mb-6" />
					<div className="flex items-center justify-between">
						<div className="flex flex-col gap-0.5">
							<span
								className="text-foreground"
								style={{ fontFamily: 'var(--font-sans)', fontSize: 13 }}
							>
								Ready to unlock
							</span>
							<span
								className="text-muted-foreground"
								style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}
							>
								{formatSats(lockData.unlockable)} available
							</span>
						</div>
						<Button
							variant="outline"
							size="sm"
							onClick={handleUnlock}
							disabled={unlocking}
						>
							{unlocking ? 'Unlocking...' : 'Unlock'}
						</Button>
					</div>
				</>
			)}
		</div>
	)
}
