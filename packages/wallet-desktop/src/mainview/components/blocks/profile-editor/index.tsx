import { useCallback, useEffect, useState } from 'react'
import { Building2, Check, AlertCircle, Loader2, Upload, User } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { BitcoinAvatar } from '@/components/blocks/bitcoin-avatar'
import { cn } from '@/lib/utils'
import type { DraftProfile } from '../../../../shared/types'
import { rpc } from '../../../rpc'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ProfileEditorProps {
	open: boolean
	onOpenChange: (open: boolean) => void
	currentProfile: DraftProfile | null
	identityKey: string
	bapId?: string
	onSaved?: () => void
}

type SchemaType = 'Person' | 'Organization'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TOGGLE_BASE =
	'flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-2 font-medium text-sm transition-colors'
const TOGGLE_ACTIVE = `${TOGGLE_BASE} bg-primary text-primary-foreground`
const TOGGLE_INACTIVE = `${TOGGLE_BASE} text-muted-foreground hover:bg-muted hover:text-foreground`

function resolveSchemaType(profile: DraftProfile | null): SchemaType {
	return profile?.['@type'] === 'Organization' ? 'Organization' : 'Person'
}

function placeholderFor(type: SchemaType, person: string, org: string): string {
	return type === 'Person' ? person : org
}

// ---------------------------------------------------------------------------
// Status message
// ---------------------------------------------------------------------------

function StatusMessage({
	message,
}: {
	message: { type: 'success' | 'error'; text: string }
}) {
	const isError = message.type === 'error'
	return (
		<div
			className={cn(
				'mb-4 flex items-start gap-2 rounded-md border px-3 py-2 text-sm',
				isError
					? 'border-destructive/50 bg-destructive/10 text-destructive'
					: 'border-primary/50 bg-primary/10 text-primary',
			)}
		>
			{isError ? (
				<AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
			) : (
				<Check className="mt-0.5 h-4 w-4 shrink-0" />
			)}
			<span>{message.text}</span>
		</div>
	)
}

// ---------------------------------------------------------------------------
// Profile Editor
// ---------------------------------------------------------------------------

export function ProfileEditor({
	open,
	onOpenChange,
	currentProfile,
	identityKey,
	bapId,
	onSaved,
}: ProfileEditorProps) {
	const [schemaType, setSchemaType] = useState<SchemaType>('Person')
	const [alternateName, setAlternateName] = useState('')
	const [description, setDescription] = useState('')
	const [image, setImage] = useState('')
	const [url, setUrl] = useState('')
	const [givenName, setGivenName] = useState('')
	const [familyName, setFamilyName] = useState('')
	const [legalName, setLegalName] = useState('')

	const [saving, setSaving] = useState(false)
	const [message, setMessage] = useState<{
		type: 'success' | 'error'
		text: string
	} | null>(null)

	// Reset form when dialog opens or profile changes
	useEffect(() => {
		if (open) {
			setSchemaType(resolveSchemaType(currentProfile))
			setAlternateName(currentProfile?.alternateName ?? '')
			setDescription(currentProfile?.description ?? '')
			setImage(currentProfile?.image ?? '')
			setUrl(currentProfile?.url ?? '')
			setGivenName(currentProfile?.givenName ?? '')
			setFamilyName(currentProfile?.familyName ?? '')
			setLegalName(currentProfile?.legalName ?? '')
			setMessage(null)
		}
	}, [open, currentProfile])

	const handleSave = useCallback(async () => {
		const profile: DraftProfile = {
			'@type': schemaType,
			alternateName: alternateName.trim() || undefined,
			description: description.trim() || undefined,
			image: image.trim() || undefined,
			url: url.trim() || undefined,
		}

		if (schemaType === 'Person') {
			if (givenName.trim()) profile.givenName = givenName.trim()
			if (familyName.trim()) profile.familyName = familyName.trim()
		} else {
			if (legalName.trim()) profile.legalName = legalName.trim()
		}

		// Require at least one field
		const hasContent = Object.entries(profile).some(
			([k, v]) => k !== '@type' && v !== undefined,
		)
		if (!hasContent) {
			setMessage({ type: 'error', text: 'Please fill in at least one field' })
			return
		}

		setSaving(true)
		setMessage(null)

		try {
			const result = await rpc.request.saveDraftProfile({ profile })
			if (!result.success) {
				setMessage({
					type: 'error',
					text: result.error ?? 'Failed to save draft',
				})
				return
			}

			setMessage({ type: 'success', text: 'Draft saved.' })
			onSaved?.()

			setTimeout(() => {
				onOpenChange(false)
			}, 1000)
		} catch (err) {
			setMessage({
				type: 'error',
				text: err instanceof Error ? err.message : 'Failed to save draft',
			})
		} finally {
			setSaving(false)
		}
	}, [
		schemaType,
		alternateName,
		description,
		image,
		url,
		givenName,
		familyName,
		legalName,
		onSaved,
		onOpenChange,
	])

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[600px]">
				<DialogHeader>
					<DialogTitle>Edit Profile</DialogTitle>
					{bapId && (
						<DialogDescription className="break-all font-mono text-xs">
							{bapId}
						</DialogDescription>
					)}
				</DialogHeader>

				{message && <StatusMessage message={message} />}

				<div className="space-y-4 py-4">
					{/* Live preview */}
					<div className="flex items-center gap-4 rounded-lg border bg-muted/30 p-4">
						<BitcoinAvatar
							address={identityKey}
							imageUrl={image.trim() || undefined}
							size="lg"
						/>
						<div className="min-w-0 flex-1">
							<p className="truncate text-base font-semibold leading-tight">
								{alternateName.trim() || 'Display Name'}
							</p>
							{description.trim() && (
								<p className="mt-0.5 truncate text-sm text-muted-foreground">
									{description.trim()}
								</p>
							)}
						</div>
					</div>

					{/* Schema type toggle */}
					<div className="space-y-2">
						<Label>Profile Type</Label>
						<div className="flex rounded-lg border p-1">
							<button
								type="button"
								className={
									schemaType === 'Person' ? TOGGLE_ACTIVE : TOGGLE_INACTIVE
								}
								onClick={() => setSchemaType('Person')}
							>
								<User className="h-4 w-4" />
								Person
							</button>
							<button
								type="button"
								className={
									schemaType === 'Organization'
										? TOGGLE_ACTIVE
										: TOGGLE_INACTIVE
								}
								onClick={() => setSchemaType('Organization')}
							>
								<Building2 className="h-4 w-4" />
								Organization
							</button>
						</div>
						<p className="text-xs text-muted-foreground">
							{schemaType === 'Person'
								? 'A personal identity with first/last name fields'
								: 'A business or organization with legal name'}
						</p>
					</div>

					{/* Display Name */}
					<div className="space-y-2">
						<Label htmlFor="pe-name">Display Name</Label>
						<Input
							id="pe-name"
							type="text"
							placeholder={placeholderFor(
								schemaType,
								'Your name or handle',
								'Organization name',
							)}
							value={alternateName}
							onChange={(e) => setAlternateName(e.target.value)}
						/>
						<p className="text-xs text-muted-foreground">
							{placeholderFor(
								schemaType,
								'How you want to be known in the Bitcoin ecosystem',
								'The public name for your organization',
							)}
						</p>
					</div>

					{/* Description / Bio */}
					<div className="space-y-2">
						<Label htmlFor="pe-description">
							{placeholderFor(schemaType, 'Bio / Description', 'About')}
						</Label>
						<Textarea
							id="pe-description"
							className="resize-none"
							rows={4}
							placeholder={placeholderFor(
								schemaType,
								'Tell people about yourself...',
								'Describe your organization...',
							)}
							value={description}
							onChange={(e) => setDescription(e.target.value)}
						/>
					</div>

					{/* Avatar URL */}
					<div className="space-y-2">
						<Label htmlFor="pe-image">Avatar URL</Label>
						<Input
							id="pe-image"
							type="url"
							placeholder="ord://txid or https://..."
							value={image}
							onChange={(e) => setImage(e.target.value)}
						/>
						<p className="text-xs text-muted-foreground">
							On-chain ordinal URL or any image URL for your avatar
						</p>
					</div>

					{/* Website */}
					<div className="space-y-2">
						<Label htmlFor="pe-url">Website</Label>
						<Input
							id="pe-url"
							type="url"
							placeholder="https://example.com"
							value={url}
							onChange={(e) => setUrl(e.target.value)}
						/>
					</div>

					{/* Person-specific fields */}
					{schemaType === 'Person' && (
						<>
							<div className="space-y-2">
								<Label htmlFor="pe-given-name">First Name</Label>
								<Input
									id="pe-given-name"
									type="text"
									placeholder="John"
									value={givenName}
									onChange={(e) => setGivenName(e.target.value)}
								/>
							</div>
							<div className="space-y-2">
								<Label htmlFor="pe-family-name">Last Name</Label>
								<Input
									id="pe-family-name"
									type="text"
									placeholder="Doe"
									value={familyName}
									onChange={(e) => setFamilyName(e.target.value)}
								/>
							</div>
						</>
					)}

					{/* Organization-specific fields */}
					{schemaType === 'Organization' && (
						<div className="space-y-2">
							<Label htmlFor="pe-legal-name">Legal Name</Label>
							<Input
								id="pe-legal-name"
								type="text"
								placeholder="Acme Corporation Inc."
								value={legalName}
								onChange={(e) => setLegalName(e.target.value)}
							/>
							<p className="text-xs text-muted-foreground">
								The official registered legal name of your organization
							</p>
						</div>
					)}

					{/* Publishing note */}
					<div className="rounded-lg border border-primary/20 bg-primary/5 p-3">
						<div className="flex gap-2">
							<Upload className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
							<div className="space-y-1">
								<p className="text-sm font-medium">Publishing to Blockchain</p>
								<p className="text-xs text-muted-foreground">
									After saving a draft, use "Publish Profile" to commit it
									on-chain. This requires a small transaction fee.
								</p>
							</div>
						</div>
					</div>
				</div>

				<DialogFooter>
					<Button
						type="button"
						variant="outline"
						disabled={saving}
						onClick={() => onOpenChange(false)}
					>
						Cancel
					</Button>
					<Button type="button" disabled={saving} onClick={handleSave}>
						{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
						{saving ? 'Saving...' : 'Save Draft'}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	)
}
