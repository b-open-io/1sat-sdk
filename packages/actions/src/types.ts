/**
 * Core types for the action pattern.
 */

import type { OneSatServices } from '@1sat/client'
import type { WalletInterface } from '@bsv/sdk'
import type { FundingProvider } from './funding'

/**
 * Context passed to all actions.
 * Contains the wallet and optional services for backend operations.
 */
export interface OneSatContext {
	/** BRC-100 compatible wallet interface */
	wallet: WalletInterface
	/** Optional services for operations requiring backend (purchases, lookups) */
	services?: OneSatServices
	/** Network chain */
	chain: 'main' | 'test'
	/** Optional WhatsOnChain API key */
	wocApiKey?: string
	/** Local storage directory for actions that need persistence (SQLite). In browsers, IDB is used automatically. In Node/Bun without this set, defaults to cwd. */
	dataDir?: string
	/** Enable debug logging of derivation info for fund recovery */
	debug?: boolean
	/** Structured log callback — receives derivation details for each action execution */
	log?: (entry: ActionLogEntry) => void
	/**
	 * @deprecated Unused for routing. Prefer per-call `useModule` on actions.
	 */
	isBaseWallet: boolean
}

/**
 * Base options for actions that create transactions.
 * Extend this in action-specific request types to inherit funding support.
 */
export interface ActionOptions {
	/** Optional external funding provider. When set, the provider funds and
	 *  broadcasts the transaction instead of the wallet. */
	fundingProvider?: FundingProvider
	/**
	 * Opt-in permission module. Default **false** (local pipeline).
	 * When true, stamp scheme dispatch / input labels for WPM routing.
	 */
	usePermissionModule?: boolean
	/** @deprecated use usePermissionModule */
	useOneSatModule?: boolean
	/** @deprecated use usePermissionModule */
	useModule?: boolean
	/**
	 * BRC-99 scheme id when usePermissionModule is true.
	 * Default `1sat` (collectables). Use `opns` / `bsv21` / `lock` per action domain.
	 */
	permissionScheme?: import('@1sat/types').PermissionSchemeId
}

/**
 * Structured log entry emitted by actions when debug mode is enabled.
 * Captures derivation details needed for fund recovery.
 */
export interface ActionLogEntry {
	timestamp: string
	action: string
	input: unknown
	txid?: string
	rawtx?: string
	outputs?: Array<{
		index: number
		protocolID?: unknown
		keyID?: string
		basket?: string
		customInstructions?: string
		satoshis: number
	}>
	error?: string
}

/**
 * JSON Schema property definition for action input schemas.
 */
export interface JsonSchemaProperty {
	type: 'string' | 'number' | 'integer' | 'boolean' | 'object' | 'array'
	description?: string
	enum?: string[]
	default?: unknown
	items?: JsonSchemaProperty
	properties?: Record<string, JsonSchemaProperty>
	required?: string[]
}

/**
 * Action category for grouping related operations.
 */
export type ActionCategory =
	| 'addresses'
	| 'balance'
	| 'collections'
	| 'payments'
	| 'ordinals'
	| 'tokens'
	| 'inscriptions'
	| 'locks'
	| 'signing'
	| 'sweep'
	| 'opns'
	| 'social'
	| 'identity'
	| 'sync'

/**
 * Metadata describing an action for AI agents and tooling.
 */
export interface ActionMetadata<_TInput = unknown> {
	/** Unique action name */
	name: string
	/** Human-readable description of what the action does */
	description: string
	/** Category for grouping */
	category: ActionCategory
	/** JSON Schema for the input parameters (MCP-compatible) */
	inputSchema: {
		type: 'object'
		properties: Record<string, JsonSchemaProperty>
		required?: string[]
	}
	/** Whether this action requires OneSatServices to be provided in context */
	requiresServices?: boolean
}

/**
 * An action is a self-describing operation that can be executed with a context.
 */
export interface Action<TInput = unknown, TOutput = unknown> {
	/** Metadata describing the action */
	meta: ActionMetadata<TInput>
	/** Execute the action with context and input */
	execute: (ctx: OneSatContext, input: TInput) => Promise<TOutput>
}

/**
 * Helper to create a context object from a wallet and options.
 */
export function createContext(
	wallet: WalletInterface,
	options?: {
		services?: OneSatServices
		chain?: 'main' | 'test'
		wocApiKey?: string
		dataDir?: string
		debug?: boolean
		log?: (entry: ActionLogEntry) => void
		/** @deprecated Unused for routing */
		isBaseWallet?: boolean
	},
): OneSatContext {
	return {
		wallet,
		services: options?.services,
		chain: options?.chain ?? 'main',
		wocApiKey: options?.wocApiKey,
		dataDir: options?.dataDir,
		debug: options?.debug,
		log: options?.log,
		isBaseWallet: options?.isBaseWallet ?? true,
	}
}
