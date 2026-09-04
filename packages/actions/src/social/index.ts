/**
 * Social Module
 *
 * Actions for on-chain social protocol transactions (BSocial).
 */

import {
	BSocial,
	BSocialActionType,
	type BSocialFollow,
	type BSocialLike,
	type BSocialPost,
	type BSocialVideo,
} from '@1sat/templates'
import { BSOCIAL_BASKET } from '../constants.js'
import { applyBapAip } from '../signing/aip.js'
import type { Action, ActionOptions } from '../types.js'
import { executeTrackedAction } from '../utils/createTrackedAction.js'

// ============================================================================
// Types
// ============================================================================

export interface CreateSocialPostRequest extends ActionOptions {
	/** Application name for MAP attribution (e.g. 'bsv-mcp', '1sat-website') */
	app: string
	/** Post content (text) */
	content: string
	/** Content type — defaults to text/plain */
	contentType?: 'text/plain' | 'text/markdown'
	/** Optional tags */
	tags?: string[]
}

export interface SocialResponse {
	txid?: string
	tx?: number[]
	error?: string
}

// ============================================================================
// Internal helpers
// ============================================================================

/**
 * Build wallet output tags from a BSocial action's MAP fields.
 * Tags follow the format `key:value` for filtered history queries.
 */
function buildSocialTags(
	action: {
		app: string
		type: BSocialActionType
		context?: string
		contextValue?: string
	},
	tags?: string[],
): string[] {
	const out: string[] = [`app:${action.app}`, `type:${action.type}`]

	if (action.context) out.push(`context:${action.context}`)
	if (action.contextValue) out.push(`contextValue:${action.contextValue}`)

	if (action.type === BSocialActionType.LIKE && 'txid' in action) {
		out.push(`tx:${(action as BSocialLike).txid}`)
	}
	if (action.type === BSocialActionType.FOLLOW && 'bapId' in action) {
		out.push(`bapId:${(action as BSocialFollow).bapId}`)
	}
	if (action.type === BSocialActionType.VIDEO && 'provider' in action) {
		out.push(`provider:${(action as BSocialVideo).provider}`)
	}

	if (tags) {
		for (const tag of tags) out.push(`tag:${tag}`)
	}

	return out
}

// ============================================================================
// Actions
// ============================================================================

/**
 * Create an on-chain social post (B:// + MAP + AIP).
 */
export const createSocialPost: Action<CreateSocialPostRequest, SocialResponse> =
	{
		meta: {
			name: 'createSocialPost',
			description: 'Create an on-chain social post signed with BAP identity',
			category: 'social',
			inputSchema: {
				type: 'object',
				properties: {
					app: {
						type: 'string',
						description:
							'Application name for MAP attribution (e.g. bsv-mcp, 1sat-website)',
					},
					content: {
						type: 'string',
						description: 'Post content',
					},
					contentType: {
						type: 'string',
						description: 'Content type (text/plain or text/markdown)',
						enum: ['text/plain', 'text/markdown'],
					},
					tags: {
						type: 'array',
						description: 'Optional tags',
						items: { type: 'string' },
					},
				},
				required: ['app', 'content'],
			},
		},
		async execute(ctx, input) {
			try {
				const post: BSocialPost = {
					app: input.app,
					type: BSocialActionType.POST,
					content: input.content,
					mediaType: input.contentType ?? 'text/plain',
					encoding: 'utf-8',
				}

				const postScript = await BSocial.createPost(post, input.tags)
				const lockingScript = await applyBapAip(ctx, postScript)

				const result = await executeTrackedAction(
					ctx.wallet,
					{
						description: 'Social post',
						outputs: [
							{
								lockingScript: lockingScript.toHex(),
								satoshis: 0,
								outputDescription: 'BSocial post',
								basket: BSOCIAL_BASKET,
								tags: buildSocialTags(post, input.tags),
							},
						],
						options: {
							acceptDelayedBroadcast: false,
							randomizeOutputs: false,
						},
					},
					input.fundingProvider,
				)

				if (!result.txid) {
					return { error: 'no-txid-returned' }
				}

				return {
					txid: result.txid,
					tx: result.tx,
				}
			} catch (error) {
				console.error('[createSocialPost]', error)
				return {
					error: error instanceof Error ? error.message : 'unknown-error',
				}
			}
		},
	}

/** All social actions for registry */
export const socialActions = [createSocialPost]
