import { cn } from '@/lib/utils'
import { type VariantProps, cva } from 'class-variance-authority'
import type * as React from 'react'

const badgeVariants = cva(
	'inline-flex items-center px-2 py-0.5 text-xs font-mono font-medium transition-colors',
	{
		variants: {
			variant: {
				default: 'bg-primary text-primary-foreground',
				secondary:
					'bg-secondary text-secondary-foreground border border-border',
				destructive: 'bg-destructive text-destructive-foreground',
				outline: 'border border-border text-foreground',
			},
		},
		defaultVariants: {
			variant: 'default',
		},
	},
)

function Badge({
	className,
	variant,
	...props
}: React.ComponentProps<'div'> & VariantProps<typeof badgeVariants>) {
	return (
		<div
			data-slot="badge"
			className={cn(badgeVariants({ variant }), className)}
			{...props}
		/>
	)
}

export { Badge, badgeVariants }
