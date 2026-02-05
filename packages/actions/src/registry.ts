/**
 * Action registry for runtime discovery and MCP integration.
 */

import type { Action, ActionCategory } from './types'

// biome-ignore lint/suspicious/noExplicitAny: Registry needs to store actions with any input/output types
type AnyAction = Action<any, any>

/**
 * MCP-compatible tool definition.
 */
export interface McpTool {
	name: string
	description: string
	inputSchema: object
}

/**
 * Registry for collecting and discovering actions at runtime.
 */
export class ActionRegistry {
	private actions = new Map<string, AnyAction>()

	/**
	 * Register an action.
	 */
	register(action: AnyAction): void {
		this.actions.set(action.meta.name, action)
	}

	/**
	 * Register multiple actions.
	 */
	registerAll(actions: AnyAction[]): void {
		for (const action of actions) {
			this.register(action)
		}
	}

	/**
	 * Get an action by name.
	 */
	get(name: string): AnyAction | undefined {
		return this.actions.get(name)
	}

	/**
	 * Check if an action exists.
	 */
	has(name: string): boolean {
		return this.actions.has(name)
	}

	/**
	 * List all registered actions.
	 */
	list(): Action[] {
		return Array.from(this.actions.values())
	}

	/**
	 * List actions by category.
	 */
	listByCategory(category: ActionCategory): Action[] {
		return this.list().filter((a) => a.meta.category === category)
	}

	/**
	 * Get action names.
	 */
	names(): string[] {
		return Array.from(this.actions.keys())
	}

	/**
	 * Convert to MCP-compatible tool list.
	 * Prefixes names with "1sat__" for namespace isolation.
	 */
	toMcpTools(): McpTool[] {
		return this.list().map((action) => ({
			name: `1sat__${action.meta.name}`,
			description: action.meta.description,
			inputSchema: action.meta.inputSchema,
		}))
	}

	/**
	 * Number of registered actions.
	 */
	get size(): number {
		return this.actions.size
	}
}

/**
 * Global action registry singleton.
 */
export const actionRegistry = new ActionRegistry()
