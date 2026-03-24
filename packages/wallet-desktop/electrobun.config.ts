import type { ElectrobunConfig } from "electrobun";

export default {
	app: {
		name: "1Sat",
		identifier: "app.1sat",
		version: "0.0.1",
		urlSchemes: ["1sat", "bap"],
	},
	build: {
		bun: {
			entrypoint: "src/bun/index.ts",
			external: [
				"pg", "pg-native", "pg-query-stream",
				"mysql", "mysql2",
				"oracledb",
				"tedious",
				"better-sqlite3",
				"sqlite3",
			],
		},
		copy: {
			"dist/index.html": "views/mainview/index.html",
			"dist/assets": "views/mainview/assets",
			"src/preloads/cwi.ts": "views/cwi-preload/index.js",
		},
		scripts: {
			postBuild: "scripts/post-build.ts",
		},
		watchIgnore: ["dist/**"],
		mac: {
			bundleCEF: false,
			icons: "icon.iconset",
			codesign: true,
			notarize: true,
		},
		linux: {
			bundleCEF: false,
		},
		win: {
			bundleCEF: false,
		},
	},
	release: {
		baseUrl: process.env.RELEASE_BUCKET_URL || "",
	},
} satisfies ElectrobunConfig;
