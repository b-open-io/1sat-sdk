import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Bot, Sparkles } from 'lucide-react'
import { useState } from 'react'

// ---------------------------------------------------------------------------
// AgentPopover
// ---------------------------------------------------------------------------

interface AgentPopoverProps {
	onOpenAgent?: () => void
}

export function AgentPopover({ onOpenAgent }: AgentPopoverProps) {
	const [open, setOpen] = useState(false)

	const handleOpen = () => {
		setOpen(false)
		onOpenAgent?.()
	}

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<Button
					variant="ghost"
					size="icon-xs"
					className="text-muted-foreground disabled:opacity-30"
					style={{ borderRadius: 5 }}
					aria-label="AI Agent"
				>
					<Bot size={14} />
				</Button>
			</PopoverTrigger>
			<PopoverContent
				align="end"
				sideOffset={6}
				className="p-0 border-border shadow-xl"
				style={{ width: 280, borderRadius: 0 }}
			>
				{/* Header */}
				<div className="flex items-center gap-2.5 px-4 py-3 border-b border-border">
					<div
						className="flex items-center justify-center size-6 rounded-[4px]"
						style={{ background: 'oklch(0.35 0.15 290)' }}
					>
						<Bot size={13} style={{ color: 'oklch(0.78 0.18 290)' }} />
					</div>
					<div>
						<p
							className="text-[12px] font-semibold text-foreground leading-tight"
							style={{ fontFamily: 'Space Grotesk, sans-serif' }}
						>
							AI Agent
						</p>
						<p className="text-[10px] text-muted-foreground leading-tight">
							Powered by 1Sat
						</p>
					</div>
				</div>

				{/* Body */}
				<div className="px-4 py-4">
					<div className="flex items-start gap-3 mb-4">
						<Sparkles
							size={14}
							style={{ color: 'oklch(0.72 0.18 290)', marginTop: 1 }}
							className="shrink-0"
						/>
						<p
							className="text-xs text-muted-foreground leading-relaxed"
							style={{ fontFamily: 'Space Grotesk, sans-serif' }}
						>
							The AI Agent sidebar lets you interact with on-chain data, execute
							wallet actions, and browse 1Sat Ordinals using natural language.
						</p>
					</div>

					<div
						className="flex items-center gap-2 px-3 py-2 border border-dashed rounded-[3px] mb-4"
						style={{ borderColor: 'oklch(0.35 0.08 290)' }}
					>
						<span
							className="text-[10px] font-mono"
							style={{
								color: 'oklch(0.65 0.12 290)',
								fontFamily: 'JetBrains Mono, monospace',
							}}
						>
							coming soon
						</span>
					</div>

					<Button
						className="w-full h-7 text-xs font-medium"
						style={{
							background: 'oklch(0.35 0.15 290)',
							color: 'oklch(0.9 0.05 290)',
						}}
						onClick={handleOpen}
						disabled
					>
						<Bot size={12} />
						Open Agent Sidebar
					</Button>
				</div>
			</PopoverContent>
		</Popover>
	)
}
