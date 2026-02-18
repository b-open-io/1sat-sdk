await Bun.build({
	entrypoints: ["./src/index.ts"],
	outdir: "./dist",
	target: "browser",
	format: "esm",
	minify: false,
	external: ["react", "react/jsx-runtime", "@1sat/connect"],
	banner: '"use client";',
	define: {
		"process.env.NODE_ENV": '"production"',
	},
});
