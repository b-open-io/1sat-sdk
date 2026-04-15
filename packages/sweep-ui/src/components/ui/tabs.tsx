import * as React from 'react'
import { cn } from '../../lib/utils'

type TabsContextValue = {
	value: string
	onValueChange: (value: string) => void
}

const TabsContext = React.createContext<TabsContextValue | null>(null)

function useTabsContext() {
	const context = React.useContext(TabsContext)
	if (!context) {
		throw new Error('Tabs components must be used within a <Tabs> provider')
	}
	return context
}

function Tabs({
	value,
	onValueChange,
	className,
	...props
}: React.ComponentProps<'div'> & {
	value: string
	onValueChange: (value: string) => void
}) {
	return (
		<TabsContext.Provider value={{ value, onValueChange }}>
			<div
				data-slot="tabs"
				className={cn('flex flex-col gap-2', className)}
				{...props}
			/>
		</TabsContext.Provider>
	)
}

function TabsList({ className, ...props }: React.ComponentProps<'div'>) {
	return (
		<div
			data-slot="tabs-list"
			className={cn(
				'inline-flex h-9 items-center justify-start gap-1 rounded-lg bg-muted p-1 text-muted-foreground',
				className,
			)}
			{...props}
		/>
	)
}

function TabsTrigger({
	value,
	className,
	...props
}: React.ComponentProps<'button'> & { value: string }) {
	const context = useTabsContext()
	const isActive = context.value === value
	return (
		<button
			data-slot="tabs-trigger"
			data-active={isActive ? '' : undefined}
			className={cn(
				'inline-flex items-center justify-center whitespace-nowrap rounded-md px-3 py-1 text-sm font-medium transition-all outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50',
				isActive && 'bg-background text-foreground shadow-sm',
				className,
			)}
			onClick={() => context.onValueChange(value)}
			{...props}
		/>
	)
}

function TabsContent({
	value,
	className,
	...props
}: React.ComponentProps<'div'> & { value: string }) {
	const context = useTabsContext()
	if (context.value !== value) return null
	return (
		<div
			data-slot="tabs-content"
			className={cn('mt-2', className)}
			{...props}
		/>
	)
}

export { Tabs, TabsList, TabsTrigger, TabsContent }
