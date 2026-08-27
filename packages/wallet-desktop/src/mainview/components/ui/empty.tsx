import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from './button'

interface EmptyProps extends React.HTMLAttributes<HTMLDivElement> {
	icon?: LucideIcon
	title: string
	description?: string
	action?: { label: string; onClick: () => void }
}

export function Empty({
	icon: Icon,
	title,
	description,
	action,
	className,
	...props
}: EmptyProps) {
	return (
		<div
			className={cn(
				'flex flex-col items-center justify-center py-16 px-4 text-center',
				className,
			)}
			{...props}
		>
			{Icon && (
				<div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-muted">
					<Icon className="size-6 text-muted-foreground" />
				</div>
			)}
			<p className="text-sm font-medium text-foreground">{title}</p>
			{description && (
				<p className="mt-1 max-w-[280px] text-sm text-muted-foreground">
					{description}
				</p>
			)}
			{action && (
				<Button
					variant="outline"
					size="sm"
					className="mt-4"
					onClick={action.onClick}
				>
					{action.label}
				</Button>
			)}
		</div>
	)
}
