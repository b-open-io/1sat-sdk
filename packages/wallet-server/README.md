# @1sat/wallet-server

BRC-100 wallet storage RPC server. Symmetric counterpart to `@1sat/wallet-remote`.

Exposes a `WalletStorageProvider` (typically `StorageKnex` backed by postgres) over JSON-RPC. Supports two identity resolution modes:

- **BRC-100 mutual auth** — for public or direct client access
- **Bearer token + trusted identity header** — for proxy deployments where an upstream (e.g. 1sat-stack) has already authenticated the caller

Both can run on the same process under different routes.

## Install

```sh
bun add @1sat/wallet-server @bsv/sdk @bsv/wallet-toolbox knex pg
```

## Usage

```ts
import { createWalletRpcHandler, bearerResolver } from '@1sat/wallet-server'
import { StorageKnex } from '@bsv/wallet-toolbox'
import knex from 'knex'

const storage = new StorageKnex({
	chain: 'main',
	knex: knex({ client: 'pg', connection: process.env.DATABASE_URL }),
	commissionSatoshis: 0,
	commissionPubKeyHex: undefined,
	feeModel: { model: 'sat/kb', value: 1 },
})

const handler = createWalletRpcHandler({
	storage,
	resolveIdentity: bearerResolver({ token: process.env.INTERNAL_API_KEY! }),
})

Bun.serve({ port: 8100, fetch: handler })
```

## Resolvers

- `bearerResolver({ token, header? })` — requires `Authorization: Bearer <token>` plus `X-Identity-Key: <pubkey>`. Use for firewalled internal routes where an upstream has already authenticated the caller.
- `brc100Resolver({ wallet })` — stock BRC-100 mutual authentication via `@bsv/auth-express-middleware`. Use for public routes.

## Related packages

- `@1sat/wallet-remote` — client that talks to this server
- `@1sat/wallet-node` / `@1sat/wallet-browser` — local storage wallet factories
- `@1sat/cli` — ships the `1sat serve` command built on this package
