/**
 * Generic action executor.
 *
 * Run any registered action by name with JSON input.
 * Useful for scripting and testing.
 */

import { actionRegistry } from '@1sat/actions'
import type { GlobalFlags } from '../args'
import { loadContext } from '../context'
import { loadKey } from '../keys'
import { fatal, output } from '../output'

export async function handleActionCommand(
	args: string[],
	opts: GlobalFlags,
): Promise<void> {
	const [actionName, jsonInput] = args

	if (!actionName) {
		// List available actions
		const actions = actionRegistry.list()
		if (opts.json) {
			output(
				actions.map((a) => ({
					name: a.meta.name,
					description: a.meta.description,
					category: a.meta.category,
				})),
				opts,
			)
			return
		}

		console.log('\nRegistered actions:\n')
		const grouped = new Map<string, typeof actions>()
		for (const action of actions) {
			const cat = action.meta.category
			if (!grouped.has(cat)) grouped.set(cat, [])
			grouped.get(cat)!.push(action)
		}
		for (const [category, categoryActions] of grouped) {
			console.log(`  ${category}:`)
			for (const a of categoryActions) {
				console.log(`    ${a.meta.name.padEnd(30)} ${a.meta.description}`)
			}
			console.log()
		}
		return
	}

	const action = actionRegistry.get(actionName)
	if (!action) {
		fatal(
			`Unknown action: ${actionName}\n\nRun '1sat action' to list available actions.`,
		)
	}

	let input: unknown = {}
	if (jsonInput) {
		try {
			input = JSON.parse(jsonInput)
		} catch {
			fatal(`Invalid JSON input: ${jsonInput}`)
		}
	}

	const privateKey = await loadKey()
	const { ctx, destroy } = await loadContext(privateKey, {
		chain: opts.chain,
	})

	try {
		const result = await action.execute(ctx, input)
		output(result, opts)
	} finally {
		await destroy()
	}
}
