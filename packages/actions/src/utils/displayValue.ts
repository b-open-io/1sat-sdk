/**
 * Read a field from customInstructions JSON, falling back to a tag value.
 * customInstructions preserves case (unlike tags which are lowercased by BRC-100).
 */
export function getDisplayValue(
	output: { customInstructions?: string; tags?: string[] },
	field: string,
	tagPrefix: string,
): string | undefined {
	if (output.customInstructions) {
		try {
			const parsed = JSON.parse(output.customInstructions)
			if (parsed[field]) return parsed[field]
		} catch {}
	}
	return output.tags
		?.find((t) => t.startsWith(`${tagPrefix}:`))
		?.slice(tagPrefix.length + 1)
}
