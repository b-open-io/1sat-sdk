#!/usr/bin/env bun
/**
 * Generates the canonical action index from the live @1sat/actions registry and
 * injects it into the action-patterns skill between the ACTION-INDEX markers.
 *
 * Run: bun run scripts/gen-action-index.ts
 * The index regenerates from code, so it cannot drift from the registered actions.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { actionRegistry } from '../packages/actions/src/index.ts'

const SKILL = join(
	import.meta.dir,
	'../packages/actions/skills/action-patterns/SKILL.md',
)
const START = '<!-- ACTION-INDEX -->'
const END = '<!-- /ACTION-INDEX -->'

const byCategory = new Map<
	string,
	{ name: string; needsServices: boolean; description: string }[]
>()
for (const action of actionRegistry.list()) {
	const { name, category, description, requiresServices } = action.meta
	const list = byCategory.get(category) ?? []
	list.push({ name, needsServices: !!requiresServices, description })
	byCategory.set(category, list)
}

const lines: string[] = []
lines.push(
	`_${actionRegistry.list().length} actions, generated from the registry — do not edit by hand._`,
)
lines.push('')
lines.push('| Category | Action | Services | Purpose |')
lines.push('|----------|--------|:--------:|---------|')
for (const category of [...byCategory.keys()].sort()) {
	for (const a of byCategory
		.get(category)!
		.sort((x, y) => x.name.localeCompare(y.name))) {
		const purpose = a.description
			.replace(/\s+/g, ' ')
			.replace(/\|/g, '\\|')
			.trim()
		lines.push(
			`| \`${category}\` | \`${a.name}\` | ${a.needsServices ? '✓' : ''} | ${purpose} |`,
		)
	}
}
const table = lines.join('\n')

const src = readFileSync(SKILL, 'utf8')
const startIdx = src.indexOf(START)
if (startIdx === -1) {
	console.error(`Marker ${START} not found in ${SKILL}`)
	process.exit(1)
}
const endIdx = src.indexOf(END)
const before = src.slice(0, startIdx + START.length)
const after =
	endIdx === -1
		? src.slice(startIdx + START.length)
		: src.slice(endIdx + END.length)
const next = `${before}\n${table}\n${END}${after}`

if (next !== src) {
	writeFileSync(SKILL, next)
	console.log(
		`Wrote action index (${actionRegistry.list().length} actions) into ${SKILL}`,
	)
} else {
	console.log('Action index already up to date.')
}
