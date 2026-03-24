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
				"knex",
			],
		},
		copy: {
			"dist/index.html": "views/mainview/index.html",
			"dist/assets": "views/mainview/assets",
			"src/preloads/cwi.ts": "views/cwi-preload/index.js",
			"../wallet-mac/swift/enclave": "app/enclave",
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
