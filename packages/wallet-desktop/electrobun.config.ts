import type { ElectrobunConfig } from "electrobun";
import pkg from "./package.json";

export default {
	app: {
		name: "1Sat",
		identifier: "app.1sat",
		version: pkg.version,
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
		watchIgnore: ["dist/**"],
		mac: {
			bundleCEF: true,
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
	scripts: {
		postBuild: "scripts/post-build.ts",
	},
	release: {
		baseUrl: process.env.RELEASE_BUCKET_URL || "",
	},
} satisfies ElectrobunConfig;
