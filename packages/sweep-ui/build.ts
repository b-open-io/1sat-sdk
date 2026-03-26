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
	external: [
		'react',
		'react/jsx-runtime',
		'@bsv/sdk',
		'@1sat/actions',
		'@1sat/client',
		'@1sat/connect',
		'@1sat/types',
		'@1sat/utils',
		'bitcoin-backup',
		'sonner',
		'lucide-react',
		'clsx',
		'class-variance-authority',
		'tailwind-merge',
	],
	plugins: [stripUseClient],
	define: {
		'process.env.NODE_ENV': '"production"',
	},
})
