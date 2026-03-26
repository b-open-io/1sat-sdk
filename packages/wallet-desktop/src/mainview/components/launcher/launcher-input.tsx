import { Search } from 'lucide-react'
import { useEffect, useRef } from 'react'

interface LauncherInputProps {
	value: string
	onChange: (value: string) => void
	onEscape: () => void
	onSubmit: () => void
}

export function LauncherInput({
	value,
	onChange,
	onEscape,
	onSubmit,
}: LauncherInputProps) {
	const ref = useRef<HTMLInputElement>(null)

	useEffect(() => {
		const timer = setTimeout(() => ref.current?.focus(), 50)
		return () => clearTimeout(timer)
	}, [])

	return (
		<div className="flex items-center gap-4 px-5 py-4 border-b border-border/50 shrink-0">
			<Search
				size={20}
				className="text-muted-foreground shrink-0"
				strokeWidth={1.75}
			/>
			<input
				ref={ref}
				type="text"
				value={value}
				onChange={(e) => onChange(e.target.value)}
				onKeyDown={(e) => {
					if (e.key === 'Escape') {
						e.preventDefault()
						onEscape()
					}
					if (e.key === 'Enter') {
						e.preventDefault()
						onSubmit()
					}
				}}
				placeholder="Search apps, URLs, or ask AI..."
				className="flex-1 bg-transparent text-foreground placeholder:text-muted-foreground/60 outline-none border-none text-base"
				autoComplete="off"
				spellCheck={false}
			/>
			<div className="flex items-center gap-2 shrink-0">
				<span className="text-[10px] text-muted-foreground/60">Ask AI</span>
				<kbd className="text-[9px] text-muted-foreground bg-muted/80 px-1.5 py-0.5 rounded">
					Tab
				</kbd>
			</div>
		</div>
	)
}
