import { cn } from '@/lib/utils'
import type * as React from 'react'

function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
	return (
		<input
			type={type}
			data-slot="input"
			className={cn(
				'flex h-9 w-full bg-muted border border-border px-3 py-1 text-sm font-mono text-foreground placeholder:text-muted-foreground outline-none focus:border-primary transition-colors disabled:cursor-not-allowed disabled:opacity-50',
				className,
			)}
			{...props}
		/>
	)
}

export { Input }
