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
import {
	Card,
	CardContent,
	CardDescription,
	CardFooter,
	CardHeader,
	CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { rpc } from '../../rpc'

// ---------------------------------------------------------------------------
// Trait editor row
// ---------------------------------------------------------------------------

interface TraitRow {
	name: string
	value: string
}

interface RoyaltyRow {
	type: string
	destination: string
	percentage: string
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
	const [result, setResult] = useState<{
		txid?: string
		collectionId?: string
	} | null>(null)
	const [error, setError] = useState<string | null>(null)

	const handlePickArtwork = useCallback(async () => {
		const res = await rpc.request.pickFile({
			allowedFileTypes: 'png,jpg,jpeg,gif,webp,svg',
		})
		if ('error' in res) {
			if (res.error !== 'No file selected') {
				setError(res.error)
			}
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
		setRoyalties((prev) => [
			...prev,
			{ type: 'paymail', destination: '', percentage: '' },
		])
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
				(r) =>
					r.destination.trim().length > 0 &&
					r.percentage.trim().length > 0,
			)

			const res = await rpc.request.mintCollection({
				base64Content: artwork.base64Content,
				contentType: artwork.contentType,
				name: name.trim(),
				description: description.trim(),
				quantity: Number(quantity),
				royalties:
					validRoyalties.length > 0 ? validRoyalties : undefined,
				app: '1sat-desktop',
			})

			if (res.error) {
				setError(res.error)
			} else {
				setResult({ txid: res.txid, collectionId: res.collectionId })
			}
		} catch (err) {
			setError(
				err instanceof Error
					? err.message
					: 'Failed to create collection',
			)
		} finally {
			setIsSubmitting(false)
		}
	}, [artwork, name, description, quantity, royalties])

	return (
		<div className="flex flex-col gap-6">
			{/* Name */}
			<div className="flex flex-col gap-2">
				<Label htmlFor="collection-name">Collection Name</Label>
				<Input
					id="collection-name"
					placeholder="My Collection"
					value={name}
					onChange={(e) => setName(e.target.value)}
				/>
			</div>

			{/* Description */}
			<div className="flex flex-col gap-2">
				<Label htmlFor="collection-desc">Description</Label>
				<textarea
					id="collection-desc"
					className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
					placeholder="Describe your collection..."
					value={description}
					onChange={(e) => setDescription(e.target.value)}
				/>
			</div>

			{/* Quantity */}
			<div className="flex flex-col gap-2">
				<Label htmlFor="collection-qty">Total Items</Label>
				<Input
					id="collection-qty"
					type="number"
					min={1}
					placeholder="100"
					value={quantity}
					onChange={(e) => setQuantity(e.target.value)}
				/>
			</div>

			{/* Artwork */}
			<div className="flex flex-col gap-2">
				<Label>Collection Artwork</Label>
				{artwork ? (
					<div className="flex items-center gap-3 rounded-md border border-border bg-muted/50 px-4 py-3">
						<Upload size={16} className="text-muted-foreground" />
						<span className="text-sm truncate flex-1">
							{artwork.filename}
						</span>
						<Button
							variant="ghost"
							size="icon"
							onClick={() => setArtwork(null)}
						>
							<Trash2 size={14} />
						</Button>
					</div>
				) : (
					<Button
						variant="outline"
						onClick={handlePickArtwork}
						className="justify-start gap-2"
					>
						<Upload size={16} />
						Choose File
					</Button>
				)}
			</div>

			{/* Royalties */}
			<div className="flex flex-col gap-2">
				<div className="flex items-center justify-between">
					<Label>Royalties</Label>
					<Button
						variant="ghost"
						size="sm"
						onClick={addRoyalty}
						className="gap-1 text-xs"
					>
						<Plus size={14} />
						Add
					</Button>
				</div>
				{royalties.map((royalty, index) => (
					<div
						key={`royalty-${index}`}
						className="flex items-center gap-2"
					>
						<Input
							placeholder="paymail"
							value={royalty.type}
							onChange={(e) =>
								updateRoyalty(index, 'type', e.target.value)
							}
							className="w-24"
						/>
						<Input
							placeholder="address or paymail"
							value={royalty.destination}
							onChange={(e) =>
								updateRoyalty(
									index,
									'destination',
									e.target.value,
								)
							}
							className="flex-1"
						/>
						<Input
							placeholder="%"
							value={royalty.percentage}
							onChange={(e) =>
								updateRoyalty(
									index,
									'percentage',
									e.target.value,
								)
							}
							className="w-20"
						/>
						<Button
							variant="ghost"
							size="icon"
							onClick={() => removeRoyalty(index)}
						>
							<Trash2 size={14} />
						</Button>
					</div>
				))}
			</div>

			<Separator />

			{/* Result */}
			{result?.txid && (
				<div className="flex items-start gap-3 rounded-md border border-primary/20 bg-primary/5 p-4">
					<CheckCircle2 className="mt-0.5 size-5 flex-shrink-0 text-primary" />
					<div className="min-w-0 flex flex-col gap-1">
						<p className="text-sm font-medium">
							Collection created
						</p>
						{result.collectionId && (
							<p className="text-xs text-muted-foreground font-mono">
								ID: {result.collectionId}
							</p>
						)}
						<a
							href={`https://whatsonchain.com/tx/${result.txid}`}
							target="_blank"
							rel="noopener noreferrer"
							className="inline-flex items-center gap-1 transition-colors hover:text-foreground"
						>
							<Badge
								variant="outline"
								className="max-w-full truncate text-xs font-mono"
							>
								{result.txid}
							</Badge>
							<ExternalLink className="size-3 flex-shrink-0" />
						</a>
					</div>
				</div>
			)}

			{/* Error */}
			{error && (
				<div className="flex items-start gap-3 rounded-md border border-destructive/20 bg-destructive/5 p-4">
					<AlertCircle className="mt-0.5 size-5 flex-shrink-0 text-destructive" />
					<div className="flex flex-col gap-1">
						<p className="text-sm font-medium">
							Collection creation failed
						</p>
						<p className="text-xs text-muted-foreground">{error}</p>
					</div>
				</div>
			)}

			<Button
				className="w-full"
				onClick={handleSubmit}
				disabled={!canSubmit || isSubmitting}
			>
				{isSubmitting ? (
					<>
						<Loader2 className="animate-spin" />
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
			if (res.error !== 'No file selected') {
				setError(res.error)
			}
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
		setTraits((prev) => [...prev, { name: '', value: '' }])
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
		collectionId.trim().length > 0 &&
		name.trim().length > 0 &&
		artwork !== null

	const handleSubmit = useCallback(async () => {
		if (!artwork) return
		setIsSubmitting(true)
		setError(null)
		setResult(null)

		try {
			const validTraits = traits.filter(
				(t) =>
					t.name.trim().length > 0 && t.value.trim().length > 0,
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
			setError(
				err instanceof Error ? err.message : 'Failed to mint item',
			)
		} finally {
			setIsSubmitting(false)
		}
	}, [artwork, name, collectionId, mintNumber, rank, traits])

	return (
		<div className="flex flex-col gap-6">
			{/* Collection ID */}
			<div className="flex flex-col gap-2">
				<Label htmlFor="item-collection-id">Collection ID</Label>
				<Input
					id="item-collection-id"
					placeholder="txid_vout"
					value={collectionId}
					onChange={(e) => setCollectionId(e.target.value)}
					className="font-mono text-sm"
				/>
			</div>

			{/* Item Name */}
			<div className="flex flex-col gap-2">
				<Label htmlFor="item-name">Item Name</Label>
				<Input
					id="item-name"
					placeholder="Item #1"
					value={name}
					onChange={(e) => setName(e.target.value)}
				/>
			</div>

			{/* Artwork */}
			<div className="flex flex-col gap-2">
				<Label>Item Artwork</Label>
				{artwork ? (
					<div className="flex items-center gap-3 rounded-md border border-border bg-muted/50 px-4 py-3">
						<Upload size={16} className="text-muted-foreground" />
						<span className="text-sm truncate flex-1">
							{artwork.filename}
						</span>
						<Button
							variant="ghost"
							size="icon"
							onClick={() => setArtwork(null)}
						>
							<Trash2 size={14} />
						</Button>
					</div>
				) : (
					<Button
						variant="outline"
						onClick={handlePickArtwork}
						className="justify-start gap-2"
					>
						<Upload size={16} />
						Choose File
					</Button>
				)}
			</div>

			{/* Mint Number & Rank */}
			<div className="grid grid-cols-2 gap-4">
				<div className="flex flex-col gap-2">
					<Label htmlFor="item-mint-number">Mint Number</Label>
					<Input
						id="item-mint-number"
						type="number"
						min={1}
						placeholder="1"
						value={mintNumber}
						onChange={(e) => setMintNumber(e.target.value)}
					/>
				</div>
				<div className="flex flex-col gap-2">
					<Label htmlFor="item-rank">Rank</Label>
					<Input
						id="item-rank"
						type="number"
						min={1}
						placeholder="Optional"
						value={rank}
						onChange={(e) => setRank(e.target.value)}
					/>
				</div>
			</div>

			{/* Traits */}
			<div className="flex flex-col gap-2">
				<div className="flex items-center justify-between">
					<Label>Traits</Label>
					<Button
						variant="ghost"
						size="sm"
						onClick={addTrait}
						className="gap-1 text-xs"
					>
						<Plus size={14} />
						Add
					</Button>
				</div>
				{traits.map((trait, index) => (
					<div
						key={`trait-${index}`}
						className="flex items-center gap-2"
					>
						<Input
							placeholder="Trait name"
							value={trait.name}
							onChange={(e) =>
								updateTrait(index, 'name', e.target.value)
							}
							className="flex-1"
						/>
						<Input
							placeholder="Value"
							value={trait.value}
							onChange={(e) =>
								updateTrait(index, 'value', e.target.value)
							}
							className="flex-1"
						/>
						<Button
							variant="ghost"
							size="icon"
							onClick={() => removeTrait(index)}
						>
							<Trash2 size={14} />
						</Button>
					</div>
				))}
			</div>

			<Separator />

			{/* Result */}
			{result?.txid && (
				<div className="flex items-start gap-3 rounded-md border border-primary/20 bg-primary/5 p-4">
					<CheckCircle2 className="mt-0.5 size-5 flex-shrink-0 text-primary" />
					<div className="min-w-0 flex flex-col gap-1">
						<p className="text-sm font-medium">Item minted</p>
						<a
							href={`https://whatsonchain.com/tx/${result.txid}`}
							target="_blank"
							rel="noopener noreferrer"
							className="inline-flex items-center gap-1 transition-colors hover:text-foreground"
						>
							<Badge
								variant="outline"
								className="max-w-full truncate text-xs font-mono"
							>
								{result.txid}
							</Badge>
							<ExternalLink className="size-3 flex-shrink-0" />
						</a>
					</div>
				</div>
			)}

			{/* Error */}
			{error && (
				<div className="flex items-start gap-3 rounded-md border border-destructive/20 bg-destructive/5 p-4">
					<AlertCircle className="mt-0.5 size-5 flex-shrink-0 text-destructive" />
					<div className="flex flex-col gap-1">
						<p className="text-sm font-medium">Minting failed</p>
						<p className="text-xs text-muted-foreground">{error}</p>
					</div>
				</div>
			)}

			<Button
				className="w-full"
				onClick={handleSubmit}
				disabled={!canSubmit || isSubmitting}
			>
				{isSubmitting ? (
					<>
						<Loader2 className="animate-spin" />
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
// Collections View
// ---------------------------------------------------------------------------

export function CollectionsView() {
	return (
		<div className="p-6 max-w-2xl">
			<div className="text-xs font-mono uppercase tracking-wider text-muted-foreground mb-4">
				Collections
			</div>
			<Card>
				<CardHeader>
					<CardTitle>Collection Minting</CardTitle>
					<CardDescription>
						Create new ordinal collections or mint items into
						existing ones.
					</CardDescription>
				</CardHeader>
				<CardContent>
					<Tabs defaultValue="create">
						<TabsList className="grid w-full grid-cols-2">
							<TabsTrigger value="create">
								Create Collection
							</TabsTrigger>
							<TabsTrigger value="mint">Mint Item</TabsTrigger>
						</TabsList>
						<TabsContent value="create" className="mt-4">
							<CreateCollectionTab />
						</TabsContent>
						<TabsContent value="mint" className="mt-4">
							<MintItemTab />
						</TabsContent>
					</Tabs>
				</CardContent>
			</Card>
		</div>
	)
}
