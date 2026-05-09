// Strip "use client" directives from source files; the banner option
// adds the directive once at the bundle top.
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
	external: ['react', 'react/jsx-runtime', '@1sat/permission-module'],
	banner: '"use client";',
	plugins: [stripUseClient],
	define: {
		'process.env.NODE_ENV': '"production"',
	},
})
