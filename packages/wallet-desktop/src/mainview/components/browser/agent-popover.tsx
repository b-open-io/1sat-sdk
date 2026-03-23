import { Button } from '@/components/ui/button'
import { Bot } from 'lucide-react'

interface AgentPopoverProps {
	onOpenAgent?: () => void
}

/**
 * Agent toolbar button — clicking directly toggles the AI sidebar.
 * No popover needed since the sidebar is fully implemented.
 */
export function AgentPopover({ onOpenAgent }: AgentPopoverProps) {
	return (
		<Button
			variant="ghost"
			size="icon-xs"
			className="text-muted-foreground hover:text-foreground"
			style={{ borderRadius: 5 }}
			aria-label="Toggle AI Agent sidebar"
			onClick={() => onOpenAgent?.()}
		>
			<Bot size={14} />
		</Button>
	)
}
