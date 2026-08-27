import { cva, type VariantProps } from 'class-variance-authority'
import { Loader2, MessageSquarePlus, Pencil, Plus, Send } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

// ---------------------------------------------------------------------------
// Variant definitions
// ---------------------------------------------------------------------------

export const postButtonVariants = cva(
	'inline-flex items-center justify-center gap-2 font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50',
	{
		variants: {
			variant: {
				default:
					'rounded-md bg-primary text-primary-foreground shadow hover:bg-primary/90 px-4 py-2 text-sm',
				compact:
					'rounded-md bg-primary text-primary-foreground shadow hover:bg-primary/90 h-9 px-3 text-sm',
				fab: 'fixed bottom-6 right-6 z-50 size-14 rounded-full bg-primary text-primary-foreground shadow-lg hover:bg-primary/90 hover:shadow-xl transition-all',
				inline:
					'rounded-md border border-input bg-background text-foreground shadow-sm hover:bg-accent hover:text-accent-foreground px-3 py-1.5 text-xs',
			},
		},
		defaultVariants: {
			variant: 'default',
		},
	},
)

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PostButtonUIProps
	extends VariantProps<typeof postButtonVariants> {
	/** Additional CSS classes */
	className?: string
	/** Label for the button (default: "Post") */
	label?: string
	/** Placeholder text for the textarea */
	placeholder?: string
	/** Maximum character count (0 = unlimited) */
	maxLength?: number
	/** Disable the trigger button */
	disabled?: boolean
	/** Whether the compose dialog is open */
	dialogOpen: boolean
	/** Current content of the textarea */
	content: string
	/** Set the content of the textarea */
	onContentChange: (content: string) => void
	/** Whether a post is being submitted */
	isPosting: boolean
	/** Error message string, if present */
	error: string | null
	/** Current character count */
	charCount: number
	/** Whether the content exceeds the max length */
	overLimit: boolean
	/** Whether the post can be submitted */
	canSubmit: boolean
	/** Open the compose dialog */
	onOpen: () => void
	/** Close the compose dialog */
	onClose: () => void
	/** Submit the post */
	onSubmit: () => void
}

// ---------------------------------------------------------------------------
// Icon per variant
// ---------------------------------------------------------------------------

function VariantIcon({ variant }: { variant: PostButtonUIProps['variant'] }) {
	switch (variant) {
		case 'compact':
			return <Pencil className="size-4" aria-hidden="true" />
		case 'fab':
			return <Plus className="size-6" aria-hidden="true" />
		case 'inline':
			return <Pencil className="size-3.5" aria-hidden="true" />
		default:
			return <MessageSquarePlus className="size-4" aria-hidden="true" />
	}
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function PostButtonUI({
	variant = 'default',
	className,
	label = 'Post',
	placeholder = "What's on your mind?",
	maxLength = 0,
	disabled = false,
	dialogOpen,
	content,
	onContentChange,
	isPosting,
	error,
	charCount,
	overLimit,
	canSubmit,
	onOpen,
	onClose,
	onSubmit,
}: PostButtonUIProps) {
	const isFab = variant === 'fab'
	const isCompact = variant === 'compact'

	return (
		<>
			<button
				type="button"
				className={cn(postButtonVariants({ variant }), className)}
				onClick={onOpen}
				disabled={disabled}
				aria-label={isFab ? 'Create post' : undefined}
			>
				<VariantIcon variant={variant} />
				{!isFab && !isCompact && <span>{label}</span>}
				{isCompact && <span>{label}</span>}
			</button>

			<Dialog open={dialogOpen} onOpenChange={(open) => !open && onClose()}>
				<DialogContent className="sm:max-w-lg">
					<DialogHeader>
						<DialogTitle>Create Post</DialogTitle>
						<DialogDescription>
							Write your post. It will be inscribed on-chain using the BSocial
							protocol.
						</DialogDescription>
					</DialogHeader>

					<div className="flex flex-col gap-3 py-2">
						<textarea
							className={cn(
								'flex min-h-[120px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 resize-none',
								overLimit &&
									'border-destructive focus-visible:ring-destructive',
							)}
							placeholder={placeholder}
							value={content}
							onChange={(e) => onContentChange(e.target.value)}
							disabled={isPosting}
							aria-label="Post content"
						/>

						<div className="flex items-center justify-between">
							{maxLength > 0 ? (
								<p
									className={cn(
										'text-xs text-muted-foreground',
										overLimit && 'text-destructive font-medium',
									)}
								>
									{charCount}/{maxLength}
								</p>
							) : (
								<span />
							)}
						</div>

						{error && (
							<p className="text-sm text-destructive" role="alert">
								{error}
							</p>
						)}
					</div>

					<DialogFooter>
						<Button variant="outline" onClick={onClose} disabled={isPosting}>
							Cancel
						</Button>
						<Button
							onClick={onSubmit}
							disabled={!canSubmit}
							aria-busy={isPosting}
						>
							{isPosting ? (
								<>
									<Loader2 className="animate-spin" data-icon="inline-start" />
									Posting...
								</>
							) : (
								<>
									<Send data-icon="inline-start" />
									Post
								</>
							)}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</>
	)
}
