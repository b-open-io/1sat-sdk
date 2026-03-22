// Plugin to strip "use client" directives from source files.
// The banner option places "use client" at the top of the bundle,
// but Bun also preserves the per-file directives inline (after imports),
// which causes webpack/turbopack errors.
const stripUseClient: import('bun').BunPlugin = {
	name: 'strip-use-client',
	setup(build) {
		build.onLoad({ filter: /\.[jt]sx?$/ }, async (args) => {
			const text = await Bun.file(args.path).text()
			const stripped = text.replace(/^['"]use client['"]\s*;?\s*\n?/m, '')
			const loader = args.path.endsWith('.tsx')
				? 'tsx'
				: args.path.endsWith('.ts')
					? 'ts'
					: args.path.endsWith('.jsx')
						? 'jsx'
						: 'js'
			return { contents: stripped, loader }
		})
	},
}

await Bun.build({
	entrypoints: ['./src/index.ts'],
	outdir: './dist',
	target: 'browser',
	format: 'esm',
	minify: false,
	external: ['react', 'react/jsx-runtime', '@1sat/connect'],
	banner: '"use client";',
	plugins: [stripUseClient],
	define: {
		'process.env.NODE_ENV': '"production"',
	},
})
