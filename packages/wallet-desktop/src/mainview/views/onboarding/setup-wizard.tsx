import { Button } from '@/components/ui/button'

export function SetupWizard({ onComplete }: { onComplete: () => void }) {
	return (
		<div className="min-h-screen flex items-center justify-center">
			<div className="max-w-md w-full p-8 text-center">
				<h1 className="text-2xl font-bold text-foreground mb-2">Welcome to 1Sat</h1>
				<p className="text-sm text-muted-foreground mb-8">
					Your wallet is ready. Let's configure a few things.
				</p>
				<Button size="lg" onClick={onComplete}>
					Get Started
				</Button>
			</div>
		</div>
	)
}
