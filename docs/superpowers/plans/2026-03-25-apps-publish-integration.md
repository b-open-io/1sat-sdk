# Apps Page + Publisher Integration + UI Polish Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** (A) Add a "+" publish button to `1sat://apps` that launches the publish wizard pre-configured for HTML apps, wire the publish wizard to broadcast to the `tm_apps` overlay. (B) Fix AI model detection on onboarding to support multiple providers with retry. (C) Replace text-only identity chip in toolbar with Chrome-style profile avatar dropdown. (D) Show avatar + name on identity onboarding step.

**Architecture:** The apps page (`AppsView`) already reads from the `tm_apps` overlay via `metanet-apps`. The publish wizard (`PublishView`) already has a multi-step flow for inscribing content. We connect them. For the UI polish: the `AiStep` in `setup-wizard.tsx` currently hardcodes Ollama detection — we add a provider selector and retry button. The `IdentityChip` in `browser-layout.tsx` currently shows text — we replace with an avatar circle. The `IdentityStep` needs an avatar image display.

**Tech Stack:** React (wallet-desktop mainview), `metanet-apps` (overlay publishing), `@1sat/templates` (inscriptions), Tailwind/shadcn (UI), `@bsv/sdk` (transactions)

---

## Context for Implementors

### Key Files to Read First

| File | What it does |
|------|-------------|
| `packages/wallet-desktop/src/mainview/views/apps/index.tsx` | Current apps catalog view — reads from `metanet-apps` overlay, grid of AppCards |
| `packages/wallet-desktop/src/mainview/views/publish/index.tsx` | Publish wizard — type-picker → select → build → configure → publish steps |
| `packages/wallet-desktop/src/mainview/lib/page-registry.tsx` | Maps internal pages to React components, handles `onNavigate` routing |
| `~/code/metanet-apps/src/index.ts` | `AppCatalog` class — `publishApp()`, `findApps()`, `updateApp()`, `removeApp()` |
| `~/code/metanet-apps/src/types/index.ts` | `PublishedAppMetadata` schema — required fields for overlay broadcast |
| `~/code/clawnet/packages/cli/src/commands/publish.ts:1417-1489` | ClawNet `publishAppFlow()` — reference for dual-publish pattern |
| `~/code/clawnet/packages/cli/src/app/validation.ts` | `AppFrontmatter` Zod schema — reference for app metadata fields |

### Two Publishing Systems

1. **metanet-apps overlay** (`tm_apps`): PushDrop tokens on BSV. This is what `AppsView` reads from. Publishing here makes apps visible in the catalog immediately.
2. **ClawNet registry** (Convex API at clawnet.dev): Richer data model with versions, files, author profiles. Optional secondary broadcast.

The publish wizard should ALWAYS publish to the overlay (required for catalog visibility). ClawNet registry publish is best-effort (same as `publishAppFlow` in clawnet CLI).

### Existing Publish Wizard Structure

```
type-picker → select (project folder) → build (run build) → configure (metadata) → publish (review + broadcast)
```

The wizard currently:
- Has `ContentType = 'image' | 'video' | 'document' | 'html-app'`
- Uses mock build files (real file system not wired yet)
- Has cost estimation and balance checking
- Uses `rpc` for wallet operations

### What `PublishedAppMetadata` requires

```typescript
interface PublishedAppMetadata {
  version: '0.1.0'       // protocol version, always '0.1.0'
  name: string            // app name
  description: string     // app description
  icon: string            // URL or UHRP to icon
  domain: string          // e.g. "bitbattle.io"
  release_date: string    // ISO-8601
  // Optional:
  httpURL?: string        // https://bitbattle.io
  uhrpURL?: string        // on-chain URL
  category?: string       // e.g. "Games"
  tags?: string[]
  publisher?: string      // auto-set by AppCatalog
  banner_image_url?: string
  screenshot_urls?: string[]
}
```

---

## Task 1: Add "+" Button to AppsView Header

**Files:**
- Modify: `packages/wallet-desktop/src/mainview/views/apps/index.tsx`

This is the smallest change — a "Publish App" button in the header that navigates to the publish wizard with the html-app type pre-selected.

- [ ] **Step 1: Read the current AppsView and understand the header layout**

The header currently has: icon + "App Catalog" title + app count + refresh button. The "+" button goes in the `flex-1` gap between the count and refresh, pushed to the right.

- [ ] **Step 2: Add the Plus button next to Refresh**

In `packages/wallet-desktop/src/mainview/views/apps/index.tsx`, import `Plus` from lucide-react and add a button before the refresh button:

```tsx
// Add to imports:
import { ..., Plus } from 'lucide-react'

// In the header div, before the refresh button:
<button
	type="button"
	onClick={() => onNavigate?.('1sat://publish/new?type=html-app')}
	className="p-1.5 text-muted-foreground hover:text-foreground transition-colors"
	aria-label="Publish app"
>
	<Plus size={14} strokeWidth={1.75} />
</button>
```

- [ ] **Step 3: Verify the button renders and navigates**

Run `bun run --filter '@1sat/wallet-desktop' dev`, navigate to `1sat://apps`, confirm the "+" button appears in the header bar and clicking it navigates to `1sat://publish/new?type=html-app`.

- [ ] **Step 4: Commit**

```bash
git add packages/wallet-desktop/src/mainview/views/apps/index.tsx
git commit -m "feat(wallet-desktop): add publish button to apps catalog header"
```

---

## Task 2: Parse URL Query Params in Publish Wizard

**Files:**
- Modify: `packages/wallet-desktop/src/mainview/views/publish/index.tsx`
- Modify: `packages/wallet-desktop/src/mainview/lib/url-parser.ts` (if query params not already parsed)

The publish wizard needs to accept `?type=html-app` to skip the type-picker step and go straight to the project selection step.

- [ ] **Step 1: Check how URL params flow to views**

Read `packages/wallet-desktop/src/mainview/lib/page-registry.tsx` and the view routing to understand how `params` reaches the `PublishView` component. The `PublishViewProps` likely already has `params?: Record<string, string>`.

- [ ] **Step 2: Check url-parser handles query params**

Read `packages/wallet-desktop/src/mainview/lib/url-parser.ts`. The test at line 105 shows query params ARE parsed (`1sat://wallet/send?address=1abc&amount=1000`). Verify the parsed `query` object reaches the page component's `params` prop.

- [ ] **Step 3: Accept `type` param in PublishView**

In `packages/wallet-desktop/src/mainview/views/publish/index.tsx`, at the top of the `PublishView` component:

```tsx
export function PublishView({ onNavigate, params }: PublishViewProps) {
	// If ?type=html-app is passed, skip type-picker and start at 'select'
	const initialType = params?.type as ContentType | undefined
	const initialStep: WizardStep = initialType ? 'select' : 'type-picker'

	const [step, setStep] = useState<WizardStep>(initialStep)
	const [contentType, setContentType] = useState<ContentType | null>(initialType ?? null)
	// ... rest unchanged
```

- [ ] **Step 4: Test the deep link**

Navigate directly to `1sat://publish/new?type=html-app`. Confirm the wizard opens at the "Select" step with `html-app` content type pre-selected.

- [ ] **Step 5: Commit**

```bash
git add packages/wallet-desktop/src/mainview/views/publish/index.tsx
git commit -m "feat(wallet-desktop): accept type param in publish wizard deep link"
```

---

## Task 3: Add App Catalog Metadata Step to Publish Wizard

**Files:**
- Create: `packages/wallet-desktop/src/mainview/views/publish/app-metadata-form.tsx`
- Modify: `packages/wallet-desktop/src/mainview/views/publish/index.tsx`

When the content type is `html-app`, the "Configure" step needs additional fields for app catalog metadata (`PublishedAppMetadata`): domain, icon URL, category, tags, banner image, screenshots.

- [ ] **Step 1: Create the AppMetadataForm component**

Create `packages/wallet-desktop/src/mainview/views/publish/app-metadata-form.tsx`:

```tsx
import { Globe, Image, Tag } from 'lucide-react'

export interface AppMetadata {
	domain: string
	icon: string
	httpURL: string
	category: string
	tags: string[]
	bannerImageUrl: string
	screenshotUrls: string[]
}

interface AppMetadataFormProps {
	value: AppMetadata
	onChange: (value: AppMetadata) => void
}

export function AppMetadataForm({ value, onChange }: AppMetadataFormProps) {
	const updateField = <K extends keyof AppMetadata>(key: K, val: AppMetadata[K]) => {
		onChange({ ...value, [key]: val })
	}

	return (
		<div className="flex flex-col gap-4">
			<h3 className="text-[13px] font-semibold text-foreground flex items-center gap-2">
				<Globe size={14} strokeWidth={1.75} />
				App Catalog Settings
			</h3>
			<p className="text-[11px] text-muted-foreground -mt-2">
				These fields make your app discoverable in the App Catalog.
			</p>

			{/* Domain */}
			<label className="flex flex-col gap-1">
				<span className="text-[11px] text-muted-foreground font-medium">Domain *</span>
				<input
					type="text"
					value={value.domain}
					onChange={(e) => updateField('domain', e.target.value)}
					placeholder="myapp.io"
					className="bg-input border border-border rounded px-3 h-8 text-[12px] text-foreground placeholder:text-muted-foreground outline-none focus:border-primary"
				/>
			</label>

			{/* Icon URL */}
			<label className="flex flex-col gap-1">
				<span className="text-[11px] text-muted-foreground font-medium">Icon URL *</span>
				<input
					type="text"
					value={value.icon}
					onChange={(e) => updateField('icon', e.target.value)}
					placeholder="https://myapp.io/icon.png"
					className="bg-input border border-border rounded px-3 h-8 text-[12px] text-foreground placeholder:text-muted-foreground outline-none focus:border-primary"
				/>
			</label>

			{/* HTTP URL */}
			<label className="flex flex-col gap-1">
				<span className="text-[11px] text-muted-foreground font-medium">App URL</span>
				<input
					type="text"
					value={value.httpURL}
					onChange={(e) => updateField('httpURL', e.target.value)}
					placeholder="https://myapp.io"
					className="bg-input border border-border rounded px-3 h-8 text-[12px] text-foreground placeholder:text-muted-foreground outline-none focus:border-primary"
				/>
			</label>

			{/* Category */}
			<label className="flex flex-col gap-1">
				<span className="text-[11px] text-muted-foreground font-medium">Category</span>
				<select
					value={value.category}
					onChange={(e) => updateField('category', e.target.value)}
					className="bg-input border border-border rounded px-3 h-8 text-[12px] text-foreground outline-none focus:border-primary"
				>
					<option value="">Select category...</option>
					<option value="DeFi">DeFi</option>
					<option value="Social">Social</option>
					<option value="Games">Games</option>
					<option value="Tools">Tools</option>
					<option value="Utility">Utility</option>
					<option value="NFT">NFT</option>
				</select>
			</label>

			{/* Tags */}
			<label className="flex flex-col gap-1">
				<span className="text-[11px] text-muted-foreground font-medium">Tags (comma-separated)</span>
				<input
					type="text"
					value={value.tags.join(', ')}
					onChange={(e) => updateField('tags', e.target.value.split(',').map(t => t.trim()).filter(Boolean))}
					placeholder="gaming, blockchain, nft"
					className="bg-input border border-border rounded px-3 h-8 text-[12px] text-foreground placeholder:text-muted-foreground outline-none focus:border-primary"
				/>
			</label>

			{/* Banner Image URL */}
			<label className="flex flex-col gap-1">
				<span className="text-[11px] text-muted-foreground font-medium">Banner Image URL</span>
				<input
					type="text"
					value={value.bannerImageUrl}
					onChange={(e) => updateField('bannerImageUrl', e.target.value)}
					placeholder="https://myapp.io/banner.png"
					className="bg-input border border-border rounded px-3 h-8 text-[12px] text-foreground placeholder:text-muted-foreground outline-none focus:border-primary"
				/>
			</label>
		</div>
	)
}
```

- [ ] **Step 2: Wire AppMetadataForm into the configure step**

In `packages/wallet-desktop/src/mainview/views/publish/index.tsx`:

1. Import the form and type:
```tsx
import { AppMetadataForm, type AppMetadata } from './app-metadata-form'
```

2. Add state for app metadata:
```tsx
const [appMetadata, setAppMetadata] = useState<AppMetadata>({
	domain: '',
	icon: '',
	httpURL: '',
	category: '',
	tags: [],
	bannerImageUrl: '',
	screenshotUrls: [],
})
```

3. In the configure step's render, conditionally show the app metadata form when `contentType === 'html-app'`:
```tsx
{contentType === 'html-app' && (
	<AppMetadataForm value={appMetadata} onChange={setAppMetadata} />
)}
```

- [ ] **Step 3: Auto-populate domain from app name**

When the user enters an app name in the configure step, auto-suggest the domain:
```tsx
// In the configure step, when appName changes:
useEffect(() => {
	if (contentType === 'html-app' && configForm.appName && !appMetadata.domain) {
		setAppMetadata(prev => ({
			...prev,
			domain: configForm.appName.toLowerCase().replace(/\s+/g, '-') + '.app',
		}))
	}
}, [configForm.appName, contentType])
```

- [ ] **Step 4: Validate required app fields before proceeding to publish**

Add validation in the "Next" button handler for the configure step:
```tsx
if (contentType === 'html-app') {
	if (!appMetadata.domain || !appMetadata.icon) {
		// Show validation error — domain and icon are required for app catalog
		return
	}
}
```

- [ ] **Step 5: Commit**

```bash
git add packages/wallet-desktop/src/mainview/views/publish/app-metadata-form.tsx
git add packages/wallet-desktop/src/mainview/views/publish/index.tsx
git commit -m "feat(wallet-desktop): add app catalog metadata form to publish wizard"
```

---

## Task 4: Broadcast to tm_apps Overlay After Inscription

**Files:**
- Modify: `packages/wallet-desktop/src/mainview/views/publish/index.tsx`
- Check: `packages/wallet-desktop/package.json` (ensure `metanet-apps` dependency)

After the inscription transaction broadcasts successfully, call `AppCatalog.publishApp()` to make the app appear in the catalog. This mirrors what ClawNet does in `publishAppFlow` (lines 1461-1484).

- [ ] **Step 1: Verify metanet-apps is a dependency**

Check `packages/wallet-desktop/package.json` for `"metanet-apps"`. It's already imported in `views/apps/index.tsx`, so it should be there. If not:
```bash
cd packages/wallet-desktop && bun add metanet-apps
```

- [ ] **Step 2: Add overlay broadcast after successful inscription**

In the publish step's success handler (after `txid` is returned), add the overlay broadcast. This goes in the `PublishView` component's broadcast logic:

```tsx
import { AppCatalog } from 'metanet-apps'
import type { PublishedAppMetadata } from 'metanet-apps'

// After successful inscription broadcast, if contentType is 'html-app':
if (contentType === 'html-app' && txid) {
	try {
		const catalog = new AppCatalog({})
		const metadata: PublishedAppMetadata = {
			version: '0.1.0',
			name: configForm.appName,
			description: configForm.description,
			icon: appMetadata.icon,
			domain: appMetadata.domain,
			release_date: new Date().toISOString(),
			httpURL: appMetadata.httpURL || undefined,
			uhrpURL: `1sat://${txid}_0`,
			category: appMetadata.category || undefined,
			tags: appMetadata.tags.length > 0 ? appMetadata.tags : undefined,
			banner_image_url: appMetadata.bannerImageUrl || undefined,
			screenshot_urls: appMetadata.screenshotUrls.length > 0
				? appMetadata.screenshotUrls
				: undefined,
		}
		await catalog.publishApp(metadata)
		console.log('Published to tm_apps overlay')
	} catch (err) {
		// Best-effort — log but don't block the success state
		console.warn('tm_apps overlay broadcast failed:', err)
	}
}
```

- [ ] **Step 3: Show overlay publish status in success step**

In the success sub-state UI, add an indicator:
```tsx
{contentType === 'html-app' && (
	<p className="text-[11px] text-muted-foreground mt-2">
		App published to catalog. It will appear in the App Catalog shortly.
	</p>
)}
```

- [ ] **Step 4: Commit**

```bash
git add packages/wallet-desktop/src/mainview/views/publish/index.tsx
git commit -m "feat(wallet-desktop): broadcast html-app publishes to tm_apps overlay"
```

---

## Task 5: Add "View in Apps" Link to Success State

**Files:**
- Modify: `packages/wallet-desktop/src/mainview/views/publish/index.tsx`

After publishing an app, the success screen should have a link back to the apps catalog.

- [ ] **Step 1: Add navigation link in success sub-state**

In the success UI section of the publish step:
```tsx
{contentType === 'html-app' && (
	<button
		type="button"
		onClick={() => onNavigate?.('1sat://apps')}
		className="text-[12px] text-primary hover:underline mt-2"
	>
		View in App Catalog
	</button>
)}
```

- [ ] **Step 2: Commit**

```bash
git add packages/wallet-desktop/src/mainview/views/publish/index.tsx
git commit -m "feat(wallet-desktop): add 'View in App Catalog' link to publish success"
```

---

## Task 6: Optional — ClawNet Registry Best-Effort Publish

**Files:**
- Modify: `packages/wallet-desktop/src/mainview/views/publish/index.tsx`

Following the ClawNet CLI pattern, optionally also publish to the ClawNet registry API. This is a secondary broadcast — failure should not block success.

- [ ] **Step 1: Add ClawNet registry publish as best-effort**

After the `tm_apps` overlay broadcast, add a ClawNet API call:

```tsx
// Best-effort ClawNet registry publish (same pattern as clawnet CLI publishAppFlow)
try {
	const res = await fetch('https://clawnet.dev/api/v1/apps', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			slug: configForm.appName.toLowerCase().replace(/\s+/g, '-'),
			name: configForm.appName,
			description: configForm.description,
			domain: appMetadata.domain,
			icon: appMetadata.icon,
			version: '1.0.0',
			content: '', // APP.md content if available
			httpURL: appMetadata.httpURL || undefined,
			category: appMetadata.category || undefined,
			tags: appMetadata.tags.length > 0 ? appMetadata.tags : undefined,
			homepage: appMetadata.httpURL || undefined,
			banner_image_url: appMetadata.bannerImageUrl || undefined,
			screenshot_urls: appMetadata.screenshotUrls.length > 0
				? appMetadata.screenshotUrls
				: undefined,
			packageType: 'registry:app',
		}),
	})
	if (res.ok) {
		console.log('Published to ClawNet registry')
	}
} catch {
	// Silent — ClawNet registry is optional
}
```

NOTE: This requires authentication (BAP identity). If the wallet has a BAP identity configured, include the auth header. If not, skip silently. This task can be deferred if auth plumbing is not yet available.

- [ ] **Step 2: Commit**

```bash
git add packages/wallet-desktop/src/mainview/views/publish/index.tsx
git commit -m "feat(wallet-desktop): best-effort ClawNet registry publish for html-apps"
```

---

## Design Reference

The `browser.pen` file has mockups for both pages:
- `1sat://apps` page: node ID `gdTRs` (at x:3900, y:9000)
- `1sat://publish/new` page: node ID `1uUii` (at x:5200, y:9000)

Use `mcp__pencil__get_screenshot` with these node IDs to view the current designs if visual reference is needed.

The spec at `docs/superpowers/specs/2026-03-23-missing-pages-design.md` sections 5 and 6 describe the target designs for both pages.

---

---

# Part B: UI Polish

---

## Task 7: AI Model Screen — Provider Selector + Retry

**Files:**
- Modify: `packages/wallet-desktop/src/mainview/views/onboarding/setup-wizard.tsx` (the `AiStep` function, lines 229-359)

### Problem

The `AiStep` currently:
1. Only checks for Ollama via `rpc.request.checkAiProvider({})` (no args = default provider)
2. Shows "Ollama detected" or "Install Ollama" — no way to select LM Studio, OpenRouter, etc.
3. No retry/refresh button when detection fails

### What to change

The settings view already defines the provider list at `views/settings/index.tsx:165-184`:
```typescript
type AiProvider = 'ollama' | 'lmstudio' | 'openrouter' | 'openai' | 'anthropic'
const AI_PROVIDERS: Record<AiProvider, { baseUrl: string; label: string }> = {
  ollama:     { baseUrl: 'http://localhost:11434/v1', label: 'Ollama (Local)' },
  lmstudio:   { baseUrl: 'http://localhost:1234/v1',  label: 'LM Studio (Local)' },
  openrouter: { baseUrl: 'https://openrouter.ai/api/v1', label: 'OpenRouter' },
  openai:     { baseUrl: 'https://api.openai.com/v1', label: 'OpenAI' },
  anthropic:  { baseUrl: 'https://api.anthropic.com/v1', label: 'Anthropic' },
}
```

- [ ] **Step 1: Extract the AI_PROVIDERS constant to a shared location**

Move `AiProvider` type and `AI_PROVIDERS` map from `views/settings/index.tsx` to a new file `packages/wallet-desktop/src/mainview/lib/ai-providers.ts` so both the settings view and onboarding can import it. Re-export from the settings file so nothing breaks.

- [ ] **Step 2: Add provider selector to AiStep**

Replace the single auto-detect with:
1. A `<Select>` for the provider (default: auto-detect)
2. Auto-detect tries Ollama first, then LM Studio (both local ports)
3. A `RefreshCw` icon button next to "Detecting..." that retries detection

```tsx
function AiStep({ onAdvance }: { onAdvance: (model: string | null) => void }) {
  const [loading, setLoading] = useState(true)
  const [available, setAvailable] = useState(false)
  const [models, setModels] = useState<string[]>([])
  const [selectedModel, setSelectedModel] = useState('')
  const [selectedProvider, setSelectedProvider] = useState<AiProvider>('ollama')

  const detectProvider = useCallback(async () => {
    setLoading(true)
    setAvailable(false)
    setModels([])

    // Try selected provider first
    try {
      const res = await rpc.request.checkAiProvider({
        baseUrl: AI_PROVIDERS[selectedProvider].baseUrl,
      })
      if (res.available && res.models.length > 0) {
        setAvailable(true)
        setModels(res.models)
        setSelectedModel(res.models[0])
        setLoading(false)
        return
      }
    } catch { /* continue */ }

    // If selected didn't work, try other local providers
    const localProviders: AiProvider[] = ['ollama', 'lmstudio']
    for (const provider of localProviders) {
      if (provider === selectedProvider) continue
      try {
        const res = await rpc.request.checkAiProvider({
          baseUrl: AI_PROVIDERS[provider].baseUrl,
        })
        if (res.available && res.models.length > 0) {
          setSelectedProvider(provider)
          setAvailable(true)
          setModels(res.models)
          setSelectedModel(res.models[0])
          setLoading(false)
          return
        }
      } catch { /* continue */ }
    }

    setLoading(false)
  }, [selectedProvider])

  useEffect(() => { detectProvider() }, [])
  // ...
}
```

- [ ] **Step 3: Add retry button in the UI**

In the loading state and the "not available" state, add a retry button:
```tsx
<button
  type="button"
  onClick={detectProvider}
  disabled={loading}
  className="p-1.5 text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40"
  aria-label="Retry detection"
>
  <RefreshCw size={14} className={loading ? 'animate-spin' : ''} strokeWidth={1.75} />
</button>
```

- [ ] **Step 4: Add provider dropdown above model selector**

When models are found OR in the "not available" state, show a provider selector:
```tsx
<div className="w-full max-w-xs space-y-2">
  <Label>AI Provider</Label>
  <Select value={selectedProvider} onValueChange={(v) => {
    setSelectedProvider(v as AiProvider)
    // Re-detect with new provider
    detectProvider()
  }}>
    <SelectTrigger className="w-full">
      <SelectValue />
    </SelectTrigger>
    <SelectContent>
      {(Object.entries(AI_PROVIDERS) as [AiProvider, { label: string }][]).map(([key, { label }]) => (
        <SelectItem key={key} value={key}>{label}</SelectItem>
      ))}
    </SelectContent>
  </Select>
</div>
```

- [ ] **Step 5: Update handleSave to use the selected provider**

```tsx
const handleSave = useCallback(() => {
  const settings = {
    provider: selectedProvider,
    baseUrl: AI_PROVIDERS[selectedProvider].baseUrl,
    apiKey: '',
    model: selectedModel,
  }
  localStorage.setItem(AI_SETTINGS_KEY, JSON.stringify(settings))
  onAdvance(selectedModel)
}, [selectedProvider, selectedModel, onAdvance])
```

- [ ] **Step 6: Update the "detected" label**

Change "Ollama detected" to show the actual provider name:
```tsx
<p className="text-sm font-medium text-foreground">
  {AI_PROVIDERS[selectedProvider].label} detected
</p>
```

- [ ] **Step 7: Commit**

```bash
git add packages/wallet-desktop/src/mainview/lib/ai-providers.ts
git add packages/wallet-desktop/src/mainview/views/onboarding/setup-wizard.tsx
git add packages/wallet-desktop/src/mainview/views/settings/index.tsx
git commit -m "feat(wallet-desktop): add provider selector and retry to AI onboarding step"
```

---

## Task 8: Chrome-Style Profile Avatar in Toolbar

**Files:**
- Modify: `packages/wallet-desktop/src/mainview/components/layout/browser-layout.tsx` (the `IdentityChip` function, lines 574-752)

### Problem

The current `IdentityChip` shows a text label ("anonymous" or display name) + chevron. Chrome uses a circular avatar that opens a profile dropdown. The address bar row (`TOOLBAR_HEIGHT = 36`) needs to be slightly taller to accommodate the avatar naturally.

### What to change

- [ ] **Step 1: Bump TOOLBAR_HEIGHT from 36 to 40**

In `browser-layout.tsx` line 84:
```tsx
const TOOLBAR_HEIGHT = 40
```

This gives 4px more breathing room for the avatar + address bar. Subtle.

- [ ] **Step 2: Replace the text trigger with an avatar circle**

Replace the `PopoverTrigger` content in `IdentityChip` (lines 642-655). Currently it's a text button with chevron. Replace with a 24px avatar circle:

```tsx
<PopoverTrigger asChild>
  <button
    type="button"
    className="flex items-center justify-center shrink-0 rounded-full transition-all hover:ring-2 hover:ring-primary/30"
    style={{ width: 24, height: 24 }}
    aria-label="Profile"
  >
    {identity?.profile?.image ? (
      <img
        src={identity.profile.image as string}
        alt=""
        className="size-6 rounded-full object-cover"
      />
    ) : (
      <div
        className={cn(
          'size-6 rounded-full flex items-center justify-center text-[9px] font-semibold',
          isPublished
            ? 'bg-primary/15 text-primary'
            : 'bg-muted text-muted-foreground',
        )}
      >
        {initials ?? <UserCircle2 size={12} />}
      </div>
    )}
  </button>
</PopoverTrigger>
```

- [ ] **Step 3: Add "Other Accounts" section to the popover**

After the current identity header and actions, add a section listing other accounts (Chrome style). Use the existing `rpc.request.listAccounts()`:

```tsx
// Add state for other accounts
const [otherAccounts, setOtherAccounts] = useState<AccountInfo[]>([])

useEffect(() => {
  if (status !== 'unlocked') return
  rpc.request.listAccounts().then((r) => {
    // Filter out the current account
    setOtherAccounts(r.accounts.filter(a => !a.active))
  }).catch(() => {})
}, [status])
```

In the popover, after the Lock button section, add:
```tsx
{otherAccounts.length > 0 && (
  <>
    <Separator />
    <div className="p-1.5">
      <p className="px-2.5 py-1 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
        Other Accounts
      </p>
      {otherAccounts.map((account) => (
        <button
          key={account.id}
          type="button"
          onClick={() => {
            setOpen(false)
            rpc.request.switchAccount({ accountId: account.id })
          }}
          className="w-full flex items-center gap-2.5 px-2.5 py-1.5 text-left text-[12px] text-foreground hover:bg-muted/50 transition-colors rounded-[3px] cursor-default"
        >
          <div
            className={cn(
              'size-5 rounded-full flex items-center justify-center text-[8px] font-semibold shrink-0',
              `bg-${account.accentColor}-500/15 text-${account.accentColor}-500`,
            )}
          >
            {getInitials(account.displayName)}
          </div>
          <span style={{ fontFamily: 'var(--font-sans)' }}>
            {account.displayName}
          </span>
        </button>
      ))}
    </div>
  </>
)}
```

NOTE: Check if `AccountInfo` type and `getInitials` helper are importable from account-picker. If not, inline the helper.

- [ ] **Step 4: Commit**

```bash
git add packages/wallet-desktop/src/mainview/components/layout/browser-layout.tsx
git commit -m "feat(wallet-desktop): Chrome-style profile avatar in toolbar with account switcher"
```

---

## Task 9: Show Avatar + Name on Identity Onboarding Step

**Files:**
- Modify: `packages/wallet-desktop/src/mainview/views/onboarding/setup-wizard.tsx` (the `IdentityStep` function, lines 365-506)

### Problem

The identity step shows a generic `UserCircle2` icon. Once the user has selected a profile image during account creation (via `ProfileSetup`), it should display that avatar + name, similar to Chrome's profile selection screen.

### What to change

- [ ] **Step 1: Fetch the profile image from the account data**

Add `avatarUrl` state and load it from the account info:
```tsx
const [avatarUrl, setAvatarUrl] = useState<string | null>(null)

// In the existing useEffect that fetches identity:
useEffect(() => {
  Promise.all([
    rpc.request.getBalance(),
    rpc.request.getIdentity(),
    rpc.request.getActiveAccount().catch(() => null),
  ]).then(([bal, identity, account]) => {
    setBalance(bal.confirmed + bal.unconfirmed)
    setBapId(identity.bapId)
    if (account?.avatarUrl) setAvatarUrl(account.avatarUrl)
    if (account?.displayName && !displayName) setDisplayName(account.displayName)
  }).catch(() => {}).finally(() => setLoading(false))
}, [])
```

NOTE: Check if `rpc.request.getActiveAccount()` exists or if the account info comes through another channel. The account picker's `ProfileSetup` component stores avatar URL and display name — verify how this data flows.

- [ ] **Step 2: Replace the icon with the avatar in all identity step states**

In the "has balance, can publish" state (line 442-483), replace the generic icon:
```tsx
<div className="flex size-16 items-center justify-center rounded-full bg-muted overflow-hidden">
  {avatarUrl ? (
    <img src={avatarUrl} alt="" className="size-16 rounded-full object-cover" />
  ) : (
    <UserCircle2 className="size-8 text-muted-foreground" />
  )}
</div>
{displayName && (
  <p className="text-base font-semibold text-foreground -mb-2">{displayName}</p>
)}
```

Same pattern for the "already published" state (line 422-438) — show the avatar there too.

- [ ] **Step 3: Pre-fill display name from account data**

If `displayName` was set during `ProfileSetup`, use it as the default:
```tsx
const [displayName, setDisplayName] = useState('')
// ... later in the effect:
if (account?.displayName) setDisplayName(account.displayName)
```

This way the user sees their chosen name already filled in.

- [ ] **Step 4: Commit**

```bash
git add packages/wallet-desktop/src/mainview/views/onboarding/setup-wizard.tsx
git commit -m "feat(wallet-desktop): show profile avatar and name on identity onboarding step"
```

---

## Validation Checklist

After all tasks are complete:

1. `bun run lint` — no new lint errors
2. `bun run --filter '@1sat/wallet-desktop' build` — builds clean
3. **Apps publish:** navigate to `1sat://apps`, click "+", complete wizard, verify app appears in catalog
4. **Apps publish:** navigate directly to `1sat://publish/new?type=html-app`, verify type-picker is skipped
5. **AI step:** run onboarding with LM Studio running — verify it's detected; switch provider dropdown to Ollama; click refresh
6. **AI step:** run onboarding with nothing running — verify retry button works, provider selector is shown
7. **Profile avatar:** verify 24px avatar circle in toolbar, click opens dropdown with identity info + other accounts
8. **Profile avatar:** verify toolbar height bump (40px) looks natural, address bar isn't cramped
9. **Identity step:** verify avatar image and display name appear on the identity onboarding step
