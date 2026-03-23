import { useCallback, useState } from 'react'
import {
	AlertCircle,
	CheckCircle2,
	ExternalLink,
	Loader2,
	Plus,
	Trash2,
	Upload,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { rpc } from '../../rpc'

// ---------------------------------------------------------------------------
// Design tokens
// ---------------------------------------------------------------------------

const SECTION_HEADER =
	'text-[10px] font-medium uppercase tracking-wider text-muted-foreground'
const MONO = 'font-mono'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TraitRow {
	id: string
	name: string
	value: string
}

interface RoyaltyRow {
	id: string
	type: string
	destination: string
	percentage: string
}

// ---------------------------------------------------------------------------
// FilePickerRow — reusable file selection display
// ---------------------------------------------------------------------------

interface FilePickerRowProps {
	label: string
	filename?: string
	onPick: () => void
	onClear: () => void
}

function FilePickerRow({ label, filename, onPick, onClear }: FilePickerRowProps) {
	if (filename) {
		return (
			<div className="flex items-center gap-3 border border-border px-4 py-2.5">
				<Upload className="size-3.5 text-muted-foreground shrink-0" />
				<span className="text-xs truncate flex-1">{filename}</span>
				<Button
					variant="ghost"
					size="icon"
					className="size-7 rounded-none text-muted-foreground hover:text-destructive"
					onClick={onClear}
					aria-label="Remove file"
				>
					<Trash2 className="size-3.5" />
				</Button>
			</div>
		)
	}
	return (
		<Button
			variant="outline"
			size="sm"
			onClick={onPick}
			className="justify-start gap-2 rounded-none text-xs w-full"
		>
			<Upload className="size-3.5" />
			{label}
		</Button>
	)
}

// ---------------------------------------------------------------------------
// SuccessBanner / ErrorBanner
// ---------------------------------------------------------------------------

function SuccessBanner({ txid, label }: { txid: string; label: string }) {
	return (
		<div className="flex items-start gap-3 border border-primary/20 bg-primary/5 px-4 py-3">
			<CheckCircle2 className="mt-0.5 size-4 flex-shrink-0 text-primary" />
			<div className="min-w-0 flex flex-col gap-1">
				<p className="text-xs font-medium">{label}</p>
				<a
					href={`https://whatsonchain.com/tx/${txid}`}
					target="_blank"
					rel="noopener noreferrer"
					className="inline-flex items-center gap-1 transition-colors hover:text-foreground"
				>
					<span
						className={`text-[10px] text-muted-foreground truncate max-w-[320px] ${MONO}`}
					>
						{txid}
					</span>
					<ExternalLink className="size-3 flex-shrink-0" />
				</a>
			</div>
		</div>
	)
}

function ErrorBanner({ label, message }: { label: string; message: string }) {
	return (
		<div className="flex items-start gap-3 border border-destructive/20 bg-destructive/5 px-4 py-3">
			<AlertCircle className="mt-0.5 size-4 flex-shrink-0 text-destructive" />
			<div className="flex flex-col gap-0.5">
				<p className="text-xs font-medium">{label}</p>
				<p className="text-xs text-muted-foreground">{message}</p>
			</div>
		</div>
	)
}

// ---------------------------------------------------------------------------
// Create Collection Tab
// ---------------------------------------------------------------------------

function CreateCollectionTab() {
	const [name, setName] = useState('')
	const [description, setDescription] = useState('')
	const [quantity, setQuantity] = useState('')
	const [artwork, setArtwork] = useState<{
		base64Content: string
		contentType: string
		filename: string
	} | null>(null)
	const [royalties, setRoyalties] = useState<RoyaltyRow[]>([])
	const [isSubmitting, setIsSubmitting] = useState(false)
	const [result, setResult] = useState<{ txid?: string; collectionId?: string } | null>(null)
	const [error, setError] = useState<string | null>(null)

	const handlePickArtwork = useCallback(async () => {
		const res = await rpc.request.pickFile({
			allowedFileTypes: 'png,jpg,jpeg,gif,webp,svg',
		})
		if ('error' in res) {
			if (res.error !== 'No file selected') setError(res.error)
			return
		}
		setArtwork({
			base64Content: res.base64Content,
			contentType: res.contentType,
			filename: res.filename,
		})
		setError(null)
	}, [])

	const addRoyalty = useCallback(() => {
		setRoyalties((prev) => [...prev, { id: crypto.randomUUID(), type: 'paymail', destination: '', percentage: '' }])
	}, [])

	const removeRoyalty = useCallback((index: number) => {
		setRoyalties((prev) => prev.filter((_, i) => i !== index))
	}, [])

	const updateRoyalty = useCallback(
		(index: number, field: keyof RoyaltyRow, value: string) => {
			setRoyalties((prev) =>
				prev.map((r, i) => (i === index ? { ...r, [field]: value } : r)),
			)
		},
		[],
	)

	const canSubmit =
		name.trim().length > 0 &&
		description.trim().length > 0 &&
		Number(quantity) > 0 &&
		artwork !== null

	const handleSubmit = useCallback(async () => {
		if (!artwork) return
		setIsSubmitting(true)
		setError(null)
		setResult(null)

		try {
			const validRoyalties = royalties.filter(
				(r) => r.destination.trim().length > 0 && r.percentage.trim().length > 0,
			)
			const res = await rpc.request.mintCollection({
				base64Content: artwork.base64Content,
				contentType: artwork.contentType,
				name: name.trim(),
				description: description.trim(),
				quantity: Number(quantity),
				royalties: validRoyalties.length > 0 ? validRoyalties : undefined,
				app: '1sat-desktop',
			})
			if (res.error) {
				setError(res.error)
			} else {
				setResult({ txid: res.txid, collectionId: res.collectionId })
			}
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Failed to create collection')
		} finally {
			setIsSubmitting(false)
		}
	}, [artwork, name, description, quantity, royalties])

	return (
		<div className="flex flex-col gap-5 pt-4">
			{/* Name */}
			<div className="flex flex-col gap-2">
				<Label htmlFor="collection-name" className={SECTION_HEADER}>
					Collection Name
				</Label>
				<Input
					id="collection-name"
					placeholder="My Collection"
					value={name}
					onChange={(e) => setName(e.target.value)}
					className="rounded-none"
				/>
			</div>

			{/* Description */}
			<div className="flex flex-col gap-2">
				<Label htmlFor="collection-desc" className={SECTION_HEADER}>
					Description
				</Label>
				<textarea
					id="collection-desc"
					className="flex min-h-[72px] w-full border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
					placeholder="Describe your collection..."
					value={description}
					onChange={(e) => setDescription(e.target.value)}
				/>
			</div>

			{/* Total Items */}
			<div className="flex flex-col gap-2">
				<Label htmlFor="collection-qty" className={SECTION_HEADER}>
					Total Items
				</Label>
				<Input
					id="collection-qty"
					type="number"
					min={1}
					placeholder="100"
					value={quantity}
					onChange={(e) => setQuantity(e.target.value)}
					className={`rounded-none ${MONO}`}
				/>
			</div>

			{/* Artwork */}
			<div className="flex flex-col gap-2">
				<p className={SECTION_HEADER}>Collection Artwork</p>
				<FilePickerRow
					label="Choose Artwork"
					filename={artwork?.filename}
					onPick={handlePickArtwork}
					onClear={() => setArtwork(null)}
				/>
			</div>

			{/* Royalties */}
			<div className="flex flex-col gap-2">
				<div className="flex items-center justify-between">
					<p className={SECTION_HEADER}>Royalties</p>
					<Button
						variant="ghost"
						size="sm"
						onClick={addRoyalty}
						className="h-6 gap-1 rounded-none text-xs px-2"
					>
						<Plus className="size-3" />
						Add Row
					</Button>
				</div>
				{royalties.length > 0 && (
					<div className="flex flex-col gap-2">
						{royalties.map((royalty, index) => (
							<div
								key={royalty.id}
								className="flex items-center gap-2"
							>
								<Input
									placeholder="type"
									value={royalty.type}
									onChange={(e) => updateRoyalty(index, 'type', e.target.value)}
									className="w-20 rounded-none text-xs"
								/>
								<Input
									placeholder="destination"
									value={royalty.destination}
									onChange={(e) =>
										updateRoyalty(index, 'destination', e.target.value)
									}
									className="flex-1 rounded-none text-xs"
								/>
								<Input
									placeholder="%"
									value={royalty.percentage}
									onChange={(e) =>
										updateRoyalty(index, 'percentage', e.target.value)
									}
									className={`w-16 rounded-none text-xs ${MONO}`}
								/>
								<Button
									variant="ghost"
									size="icon"
									className="size-8 rounded-none text-muted-foreground hover:text-destructive"
									onClick={() => removeRoyalty(index)}
								>
									<Trash2 className="size-3.5" />
								</Button>
							</div>
						))}
					</div>
				)}
			</div>

			<Separator />

			{result?.txid && (
				<>
					<SuccessBanner txid={result.txid} label="Collection created" />
					{result.collectionId && (
						<p className={`text-[10px] text-muted-foreground ${MONO}`}>
							ID: {result.collectionId}
						</p>
					)}
				</>
			)}

			{error && <ErrorBanner label="Collection creation failed" message={error} />}

			<Button
				className="w-full rounded-none"
				onClick={handleSubmit}
				disabled={!canSubmit || isSubmitting}
			>
				{isSubmitting ? (
					<>
						<Loader2 className="size-4 animate-spin" />
						Creating Collection...
					</>
				) : (
					'Create Collection'
				)}
			</Button>
		</div>
	)
}

// ---------------------------------------------------------------------------
// Mint Item Tab
// ---------------------------------------------------------------------------

function MintItemTab() {
	const [collectionId, setCollectionId] = useState('')
	const [name, setName] = useState('')
	const [mintNumber, setMintNumber] = useState('')
	const [rank, setRank] = useState('')
	const [traits, setTraits] = useState<TraitRow[]>([])
	const [artwork, setArtwork] = useState<{
		base64Content: string
		contentType: string
		filename: string
	} | null>(null)
	const [isSubmitting, setIsSubmitting] = useState(false)
	const [result, setResult] = useState<{ txid?: string } | null>(null)
	const [error, setError] = useState<string | null>(null)

	const handlePickArtwork = useCallback(async () => {
		const res = await rpc.request.pickFile({
			allowedFileTypes: 'png,jpg,jpeg,gif,webp,svg',
		})
		if ('error' in res) {
			if (res.error !== 'No file selected') setError(res.error)
			return
		}
		setArtwork({
			base64Content: res.base64Content,
			contentType: res.contentType,
			filename: res.filename,
		})
		setError(null)
	}, [])

	const addTrait = useCallback(() => {
		setTraits((prev) => [...prev, { id: crypto.randomUUID(), name: '', value: '' }])
	}, [])

	const removeTrait = useCallback((index: number) => {
		setTraits((prev) => prev.filter((_, i) => i !== index))
	}, [])

	const updateTrait = useCallback(
		(index: number, field: keyof TraitRow, value: string) => {
			setTraits((prev) =>
				prev.map((t, i) => (i === index ? { ...t, [field]: value } : t)),
			)
		},
		[],
	)

	const canSubmit =
		collectionId.trim().length > 0 && name.trim().length > 0 && artwork !== null

	const handleSubmit = useCallback(async () => {
		if (!artwork) return
		setIsSubmitting(true)
		setError(null)
		setResult(null)

		try {
			const validTraits = traits.filter(
				(t) => t.name.trim().length > 0 && t.value.trim().length > 0,
			)
			const res = await rpc.request.mintCollectionItem({
				base64Content: artwork.base64Content,
				contentType: artwork.contentType,
				name: name.trim(),
				collectionId: collectionId.trim(),
				mintNumber: mintNumber ? Number(mintNumber) : undefined,
				rank: rank ? Number(rank) : undefined,
				traits: validTraits.length > 0 ? validTraits : undefined,
				app: '1sat-desktop',
			})
			if (res.error) {
				setError(res.error)
			} else {
				setResult({ txid: res.txid })
			}
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Failed to mint item')
		} finally {
			setIsSubmitting(false)
		}
	}, [artwork, name, collectionId, mintNumber, rank, traits])

	return (
		<div className="flex flex-col gap-5 pt-4">
			{/* Collection ID */}
			<div className="flex flex-col gap-2">
				<Label htmlFor="item-collection-id" className={SECTION_HEADER}>
					Collection ID
				</Label>
				<Input
					id="item-collection-id"
					placeholder="txid_vout"
					value={collectionId}
					onChange={(e) => setCollectionId(e.target.value)}
					className={`rounded-none text-xs ${MONO}`}
				/>
			</div>

			{/* Item Name */}
			<div className="flex flex-col gap-2">
				<Label htmlFor="item-name" className={SECTION_HEADER}>
					Item Name
				</Label>
				<Input
					id="item-name"
					placeholder="Item #1"
					value={name}
					onChange={(e) => setName(e.target.value)}
					className="rounded-none"
				/>
			</div>

			{/* Artwork */}
			<div className="flex flex-col gap-2">
				<p className={SECTION_HEADER}>Item Artwork</p>
				<FilePickerRow
					label="Choose Artwork"
					filename={artwork?.filename}
					onPick={handlePickArtwork}
					onClear={() => setArtwork(null)}
				/>
			</div>

			{/* Mint Number & Rank */}
			<div className="grid grid-cols-2 gap-4">
				<div className="flex flex-col gap-2">
					<Label htmlFor="item-mint-number" className={SECTION_HEADER}>
						Mint Number
					</Label>
					<Input
						id="item-mint-number"
						type="number"
						min={1}
						placeholder="1"
						value={mintNumber}
						onChange={(e) => setMintNumber(e.target.value)}
						className={`rounded-none ${MONO}`}
					/>
				</div>
				<div className="flex flex-col gap-2">
					<Label htmlFor="item-rank" className={SECTION_HEADER}>
						Rank
					</Label>
					<Input
						id="item-rank"
						type="number"
						min={1}
						placeholder="Optional"
						value={rank}
						onChange={(e) => setRank(e.target.value)}
						className={`rounded-none ${MONO}`}
					/>
				</div>
			</div>

			{/* Traits */}
			<div className="flex flex-col gap-2">
				<div className="flex items-center justify-between">
					<p className={SECTION_HEADER}>Traits</p>
					<Button
						variant="ghost"
						size="sm"
						onClick={addTrait}
						className="h-6 gap-1 rounded-none text-xs px-2"
					>
						<Plus className="size-3" />
						Add Row
					</Button>
				</div>
				{traits.length > 0 && (
					<div className="flex flex-col gap-2">
						{traits.map((trait, index) => (
							<div key={trait.id} className="flex items-center gap-2">
								<Input
									placeholder="Trait name"
									value={trait.name}
									onChange={(e) => updateTrait(index, 'name', e.target.value)}
									className="flex-1 rounded-none text-xs"
								/>
								<Input
									placeholder="Value"
									value={trait.value}
									onChange={(e) => updateTrait(index, 'value', e.target.value)}
									className="flex-1 rounded-none text-xs"
								/>
								<Button
									variant="ghost"
									size="icon"
									className="size-8 rounded-none text-muted-foreground hover:text-destructive"
									onClick={() => removeTrait(index)}
								>
									<Trash2 className="size-3.5" />
								</Button>
							</div>
						))}
					</div>
				)}
			</div>

			<Separator />

			{result?.txid && <SuccessBanner txid={result.txid} label="Item minted" />}

			{error && <ErrorBanner label="Minting failed" message={error} />}

			<Button
				className="w-full rounded-none"
				onClick={handleSubmit}
				disabled={!canSubmit || isSubmitting}
			>
				{isSubmitting ? (
					<>
						<Loader2 className="size-4 animate-spin" />
						Minting Item...
					</>
				) : (
					'Mint Item'
				)}
			</Button>
		</div>
	)
}

// ---------------------------------------------------------------------------
// CollectionsView
// ---------------------------------------------------------------------------

export function CollectionsView() {
	return (
		<div className="p-6 max-w-[600px]">
			<p className={`${SECTION_HEADER} mb-4`}>Collections</p>

			<div className="border border-border">
				<Tabs defaultValue="create">
					<TabsList className="grid w-full grid-cols-2 rounded-none border-b border-border bg-background h-auto p-0">
						<TabsTrigger
							value="create"
							className="rounded-none border-r border-border py-2.5 text-xs font-medium uppercase tracking-wide data-[state=active]:bg-muted data-[state=active]:shadow-none"
						>
							Create Collection
						</TabsTrigger>
						<TabsTrigger
							value="mint"
							className="rounded-none py-2.5 text-xs font-medium uppercase tracking-wide data-[state=active]:bg-muted data-[state=active]:shadow-none"
						>
							Mint Item
						</TabsTrigger>
					</TabsList>

					<div className="px-6 pb-6">
						<TabsContent value="create" className="mt-0">
							<CreateCollectionTab />
						</TabsContent>
						<TabsContent value="mint" className="mt-0">
							<MintItemTab />
						</TabsContent>
					</div>
				</Tabs>
			</div>
		</div>
	)
}
