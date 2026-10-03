# @1sat/wallet-server

Two servers behind one BRC-103/104 identity. Symmetric counterpart to `@1sat/wallet-remote`.

- `createStorageServer` — BRC-100 wallet storage RPC: the `@bsv/wallet-toolbox` `StorageServer`, run standalone.
- `createHostServer` — accounts (`/account/*`), paymail and messagebox.

With a Redis session store configured on both, a handshake made against either server authenticates the client on both, and on every instance behind a load balancer.

## Install

```sh
bun add @1sat/wallet-server @bsv/sdk @bsv/wallet-toolbox knex pg
```

## Usage

```ts
import { createHostServer, createStorageServer } from '@1sat/wallet-server'

const sessionStore = { redisUrl: 'redis://127.0.0.1:6379' } // omit for in-memory sessions

const storageServer = createStorageServer({
	storage, // a wallet-toolbox StorageProvider, e.g. StorageKnexPg
	wallet,
	listen: { port: 8110, host: '127.0.0.1' },
	sessionStore,
	trustProxy: 'loopback', // behind nginx on the same host
})
storageServer.start()

const host = await createHostServer({
	wallet,
	storage,
	serverIdentityKey: wallet.identityKey,
	listen: { port: 8100 },
	sessionStore,
})
await host.start()
```

## Related packages

- `@1sat/wallet-remote` — client that talks to this server
- `@1sat/wallet-node` / `@1sat/wallet-browser` — local storage wallet factories
- `@1sat/cli` — ships the `1sat serve` command built on this package
