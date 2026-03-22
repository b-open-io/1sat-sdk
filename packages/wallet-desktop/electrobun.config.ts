import type { ElectrobunConfig } from "electrobun";

export default {
	app: {
		name: "1Sat Wallet",
		identifier: "com.1satwallet",
		version: "0.0.1",
	},
	build: {
		bun: {
			entrypoint: "src/bun/index.ts",
			external: [
				"@1sat/wallet-node",
				"@1sat/wallet-mac",
				"@1sat/vault",
				"@1sat/actions",
				"@1sat/client",
				"@1sat/types",
				"@1sat/utils",
				"@bsv/sdk",
				"@bsv/wallet-toolbox",
			],
		},
		copy: {
			"dist/index.html": "views/mainview/index.html",
			"dist/assets": "views/mainview/assets",
		},
		watchIgnore: ["dist/**"],
		mac: {
			bundleCEF: false,
		},
		linux: {
			bundleCEF: false,
		},
		win: {
			bundleCEF: false,
		},
	},
} satisfies ElectrobunConfig;
