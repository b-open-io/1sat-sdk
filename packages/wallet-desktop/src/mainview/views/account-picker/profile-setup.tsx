import { Button } from '@/components/ui/button'
import { useCallback, useState } from 'react'
import { rpc } from '../../rpc'

const COLOR_OPTIONS = [
	{ name: 'blue', bg: 'bg-blue-500', ring: 'ring-blue-500' },
	{ name: 'amber', bg: 'bg-amber-500', ring: 'ring-amber-500' },
	{ name: 'rose', bg: 'bg-rose-500', ring: 'ring-rose-500' },
	{ name: 'emerald', bg: 'bg-emerald-500', ring: 'ring-emerald-500' },
	{ name: 'violet', bg: 'bg-violet-500', ring: 'ring-violet-500' },
	{ name: 'cyan', bg: 'bg-cyan-500', ring: 'ring-cyan-500' },
	{ name: 'orange', bg: 'bg-orange-500', ring: 'ring-orange-500' },
	{ name: 'pink', bg: 'bg-pink-500', ring: 'ring-pink-500' },
]

function getInitials(name: string): string {
	if (!name.trim()) return '?'
	return name
		.split(/\s+/)
		.map((w) => w[0])
		.join('')
		.toUpperCase()
		.slice(0, 2)
}

export function ProfileSetup({
	accountId,
	onComplete,
}: {
	accountId: string
	onComplete: () => void
}) {
	const [displayName, setDisplayName] = useState('')
	const [selectedColor, setSelectedColor] = useState('blue')
	const [saving, setSaving] = useState(false)

	const colorOption = COLOR_OPTIONS.find((c) => c.name === selectedColor) ?? COLOR_OPTIONS[0]

	const handleDone = useCallback(async () => {
		if (!displayName.trim()) return
		setSaving(true)
		try {
			await rpc.request.updateAccount({
				accountId,
				displayName: displayName.trim(),
				color: selectedColor,
			})
			onComplete()
		} catch (err) {
			console.error('Failed to update profile:', err)
			setSaving(false)
		}
	}, [accountId, displayName, selectedColor, onComplete])

	return (
		<div className="min-h-screen flex flex-col items-center justify-center select-none">
			<div className="max-w-sm w-full px-6">
				{/* Live preview avatar */}
				<div className="flex flex-col items-center mb-8">
					<div
						className={`w-24 h-24 rounded-full ${colorOption.bg} flex items-center justify-center text-3xl font-bold text-white mb-4 transition-colors`}
					>
						{getInitials(displayName)}
					</div>
					<p className="text-sm text-muted-foreground">
						Set up your profile
					</p>
				</div>

				{/* Name input */}
				<div className="mb-6">
					<label
						htmlFor="profile-name"
						className="block text-sm font-medium text-foreground mb-2"
					>
						Display name
					</label>
					<input
						id="profile-name"
						type="text"
						autoFocus
						value={displayName}
						onChange={(e) => setDisplayName(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === 'Enter' && displayName.trim()) handleDone()
						}}
						placeholder="Enter your name"
						className="w-full px-3 py-2 bg-card border border-border rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
					/>
				</div>

				{/* Color picker */}
				<div className="mb-8">
					<label className="block text-sm font-medium text-foreground mb-3">
						Pick a color
					</label>
					<div className="flex flex-wrap gap-2">
						{COLOR_OPTIONS.map((color) => (
							<button
								key={color.name}
								type="button"
								onClick={() => setSelectedColor(color.name)}
								className={`w-10 h-10 rounded-full ${color.bg} transition-all ${
									selectedColor === color.name
										? `ring-2 ${color.ring} ring-offset-2 ring-offset-background scale-110`
										: 'hover:scale-105'
								}`}
							/>
						))}
					</div>
				</div>

				{/* Done button */}
				<Button
					className="w-full"
					size="lg"
					disabled={!displayName.trim() || saving}
					onClick={handleDone}
				>
					{saving ? 'Saving...' : 'Done'}
				</Button>
			</div>
		</div>
	)
}
