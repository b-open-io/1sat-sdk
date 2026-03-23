/**
 * Page registry tests are skipped in bun test because the view components
 * transitively import electrobun/view which requires a browser environment
 * (window.__electrobunWebviewId). These components work correctly at runtime
 * in the Electrobun webview but cannot be imported in a Node/Bun test context.
 *
 * The registry structure is verified at compile time via TypeScript:
 * - Record<InternalPage, PageComponent> enforces every page has a component
 * - Non-internal routes return null (verified by type narrowing)
 *
 * Integration testing happens via `bun run start` (manual smoke test).
 */
import { describe, it } from 'bun:test'

describe('page-registry', () => {
	it.todo('requires browser environment — test via integration')
})
