# PR draft: Postgres support for wallet-toolbox StorageKnex

Branch: `feat/storageknex-postgres` in `ts-stack` (head `bb68b93ef`, merged with `origin/main` @ `20c761568`; wallet-toolbox 2.15.0).
Draft PR: https://github.com/bsv-blockchain/ts-stack/pull/719

---

## Title

feat(wallet-toolbox): run StorageKnex on Postgres

## Summary

`StorageKnex` can now use a knex `pg` connection. Settings report `dbtype: 'Postgres'`.
The knex schema builder already handles Postgres. The changes below cover the parts that were
dialect-specific, plus the Postgres-only behavior (int8 parsing, READ COMMITTED, concurrent index builds).

### Settings and validation

- `DBType` and `TableSettings.dbtype` include `'Postgres'`. `validateRemoteStorageSettings` in
  `StorageClientBase` accepts it. Postgres dates are handled like MySQL (Date objects). The
  storage-adapter spec enum is updated.

### int8 values

- node-postgres returns int8 (bigint columns, `count(*)`) as strings. The `StorageKnex` constructor
  calls the new `usePostgresInt8Numbers(knex)`. It wraps the knex client's `acquireConnection` and
  sets an int8 parser on each connection it hands out, so values come back as numbers, as with
  mysql2 and better-sqlite3.
- The parser is per connection, like the per-pool `types` in our reference engine. The process-wide
  `pg.types` defaults are not changed. It also covers connections acquired before `StorageKnex` was
  constructed and connections from a caller-supplied pool (`connectionPool`). It does nothing for other
  dialects.
- `Setup.createPostgresKnex(connectionJson, database?)` creates a pg knex with the same parser
  installed. The `Setup.postgresAfterCreate` hook from the earlier revision of this PR is removed.

### Migrations

- `determineDBType` returns `'Postgres'` for the `postgresql` knex dialect without sending the MySQL
  `VERSION()` probe. That probe is invalid on Postgres and would abort the migration transaction.
- The initial migration skips the non-MySQL `binary(len)` widening on Postgres. It altered `beef`
  columns that do not exist, and `bytea` is unbounded.
- `2025-02-22-001` quotes `activeStorage` in its raw update.
- `2026-09-09-001` (sync transfers) creates `sync_transfer_parts.bytes` as `bytea` on Postgres.
- Index builds on existing tables (see "Index builds" below).

### Index builds

Knex supports `config: { transaction: false }` per migration, and `KnexMigrations` passes each
migration object, including its `config`, to the knex migrator. So:

- `KnexMigrations` takes an optional `dbtype` argument. With `'Postgres'`, the 11 migrations that add
  indexes to existing tables get `config: { transaction: false }`. They build each index with
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS`. If an interrupted build left an invalid index with that
  name, it is dropped and rebuilt first.
  - Affected tables: `outputs`, `transactions`, `proven_tx_reqs`, `proven_txs`, `monitor_events`,
    `output_tags_map`, `tx_labels_map`.
  - The BRC-177 migration adds columns in one `ALTER TABLE` and skips it on a re-run when the columns
    already exist.
- When the batch includes a non-transactional migration, knex's `migrate.latest()` journals every
  migration of that batch outside its transaction. `StorageKnex.migrate` therefore calls
  `migrate.up()` one migration at a time on Postgres. Each other migration keeps its DDL and its
  journal row in one transaction.
- SQLite and MySQL are unchanged: `KnexMigrations` without `dbtype: 'Postgres'` produces the same
  configs, and the index helper emits the same statements through the schema builder. `StorageKnex`
  still uses `latest()` for them.

### StorageKnex queries

- Inserts that need the generated id use `RETURNING` on Postgres.
- `getCount` aliases the count and returns `Number(...)`.
- Raw SQL fragments with camelCase identifiers use `??` bindings. Postgres folds unquoted identifiers
  to lower case; knex quotes `??` per dialect, so MySQL and SQLite run the same statements.
- `listActionsKnex` (label CTE), `listOutputsKnex` (tag filter), `purgeData` and `reviewStatus` raw
  fragments use `??` bindings. `purgeData` binds `spendable` as a boolean instead of the literal `1`.

### Transactions and isolation

Postgres defaults to READ COMMITTED; InnoDB defaults to REPEATABLE READ. The isolation review is
under Findings. Changes:

- The prepared-BEEF epoch read and the sync-state checkpoint read take `FOR UPDATE` on Postgres, as
  they already do on MySQL.
- The `findOrInsert*` helpers catch a failed insert and look the row up again in the same transaction.
  Postgres aborts the whole transaction on any statement error. So on Postgres, inside a transaction,
  the inserts these helpers use run in a savepoint (`trx.transaction(...)`). The tables are
  `transactions`, `output_baskets`, `tx_labels`, `tx_labels_map`, `output_tags`, `output_tags_map`,
  `proven_tx_reqs` and `proven_txs`.
- `allocateChangeInput`: on Postgres, after the `FOR UPDATE` lock, it re-checks `action_batch_outputs`
  for the chosen output with a new statement. If the output is reserved it is skipped and the next
  candidate is tried.

### adminStats and admin server

- `adminStats` is built with the knex query builder: one statement of scalar subqueries with
  dialect-quoted identifiers and bound boolean and date values. It runs on MySQL and Postgres and still
  throws `WERR_NOT_IMPLEMENTED` on SQLite. Result fields are unchanged.
- The admin server's proof-request review moved to an internal module (`reqReviewQuery.ts`). On
  Postgres it uses `trunc(extract(epoch ...))` in place of `TIMESTAMPDIFF`, and `upper(encode(..., 'hex'))`
  in place of `HEX()`. MySQL keeps `TIMESTAMPDIFF` and `HEX`.

### MonitorDaemon

- `MonitorDaemonSetup.postgresConnection` (JSON node-postgres config) creates a `pg` knex with the
  same pool settings as the MySQL branch. `StorageKnex` installs the int8 parser on it.
- The operator `monitor-daemon` command accepts `--database-client postgres`. Its default database
  environment variable is then `{TEST,MAIN}_CLOUD_POSTGRES_CONNECTION`.

### Chaintracks

- `ChaintracksStorageKnex` rejects a Postgres knex with `WERR_NOT_IMPLEMENTED` before any migration
  runs. Before this PR it also failed on Postgres, but only after its migrations had run, at
  `determineDBType`. It has not been tested on Postgres.

### Remoting stores

- `KnexSessionManager`: the equal-timestamp merge no longer compares boolean columns with integers
  (`case when col = 1 ...`), which Postgres rejects. The merge result is unchanged:
  - incoming `true` sets `true`;
  - incoming `null` keeps the column;
  - incoming `false` sets `coalesce(col, false)`.
- `KnexSessionManager` and `KnexPaymentReplayStore` treat Postgres `23505` as a duplicate key. The
  `infra/wallet-infra` runtime copy of `KnexPaymentReplayStore` is synchronized.

### CI

- The `Coverage / wallet-toolbox` shard jobs start a `postgres` service (17-alpine, pinned by digest)
  and run with `RUNPOSTGRES=1` and `POSTGRES_CONNECTION`. The sync-HTTP latency jobs are unchanged.

### Release metadata

- `@bsv/wallet-toolbox`, `-client` and `-mobile` go from 2.14.5 (unpublished) to 2.15.0 (minor: new
  accepted `dbtype`, new exports). This covers `package.json` versions, `package-release-notes.json`
  (`releaseType: minor`, summary and migration appended), the CHANGELOG (the unpublished 2.14.5
  section becomes 2.15.0), package doc frontmatter, and the regenerated `package-api-migrations.md`,
  `stack-facts.md` and `baselines.json` versions.
- Toolbox API docs (`packages/wallet/wallet-toolbox/docs/*.md`) are regenerated with `pnpm doc`.
  The diff is large because these files were already behind `main`'s source. They are generated
  output only.
- The branch merges current `main` (#716). The conflicts were in generated and release-metadata files,
  which were regenerated.

## Tests

- `pg` and `@types/pg` are toolbox devDependencies.
- `RUNPOSTGRES=1` with `POSTGRES_CONNECTION` (JSON node-postgres config) adds a Postgres store wherever
  the suites already add a MySQL store under `RUNMYSQL`. Test databases are created on that server
  when missing.
- New Postgres tests:
  - `src/storage/__test/StorageKnex.postgres.test.ts`:
    - int8 values come back as numbers on a plain `knex({ client: 'pg' })`, including a connection
      acquired before `StorageKnex` was constructed;
    - the global pg parser is untouched;
    - a duplicate find-or-insert insert leaves the transaction usable;
    - `allocateChangeInput` skips an output reserved while it waited for the row lock;
    - migrations build indexes concurrently, and an invalid index is rebuilt on a re-run.
    - The savepoint and reservation tests fail with those fixes removed.
  - `src/storage/remoting/__test/KnexStores.postgres.test.ts` covers bytea sync-transfer staging,
    session boolean merges and payment-replay duplicates.
  - `test/storage/adminStats.test.ts` covers `adminStats` per period and the req-review age/hex
    columns on Postgres (and MySQL under `RUNMYSQL`), and the SQLite rejection.
- Other new tests (no database needed):
  - the per-migration `config` for each dialect;
  - Chaintracks rejecting Postgres before any query;
  - the `MonitorDaemon` Postgres branch and its int8 parser;
  - the operator `--database-client` option.
- Test fixes for a second backend:
  - `TxLabelMapTests` 13 creates its own transaction and label instead of using fixed ids that exist
    in a sync copy.
  - `usersTests` 5/6 insert each user once per database, not once per database pair.
  - `createAction2` keeps database and storage names within identifier limits (60 characters, trailing
    spaces trimmed for MySQL).
  - Legacy-wallet sync copies now sync from a migrated temporary copy of the fixture. This gives the
    same rows as the SQLite file copy, which migrates the fixture in place (including the
    `2025-03-01-001` history reset).
  - Entity suites that insert explicit ids call `_tu.advancePostgresSequences` after each test, so
    Postgres sequences stay ahead of those ids.
  - The `adminStats` req-review test sets `created_at` with the server clock. mysql2 writes `Date`s in
    the client time zone, so a client and server in different zones shifted `hoursOld`.

Results (local, Postgres 17.10, MySQL 8.4.11, Node 24.19):

| Run | Command | Result |
|---|---|---|
| SQLite only | `npx jest --testPathIgnorePatterns='man.test.ts\|live.test.ts\|bench.test.ts\|client/test\|mobile/test'` | 287 suites passed, 2 skipped (Postgres-only); 3116 tests passed, 8 skipped |
| SQLite + Postgres | same, with `RUNPOSTGRES=1 POSTGRES_CONNECTION=...` | 289 suites passed; 3123 tests passed, 1 skipped |
| SQLite + MySQL | same, with `RUNMYSQL=1 MYSQL_CONNECTION=...` | 286 suites passed, 1 failed, 2 skipped; 3094 tests passed, 22 failed, 8 skipped |
| SQLite + MySQL + Postgres | same, with both | 288 suites passed, 1 failed; 3101 tests passed, 22 failed, 1 skipped |

After the Postgres run no test database has a sequence behind its largest id.

The SQLite and SQLite + Postgres rows are from head `357ab123a`; the MySQL rows are from `bb68b93ef`, which
changes only the two tests above.

The 22 MySQL failures are all in `listActions2`, and fail the same way on `main`: the suite uses the test name
as the database name, and 22 names exceed MySQL's 64-character identifier limit. The MySQL runs need the
test databases created beforehand; the suites do not create them on MySQL.

`pnpm health:check`, `pnpm lint`, `pnpm format:check` and `pnpm typecheck` pass on head `bb68b93ef`.

## Findings

- **Isolation review.** These paths were reviewed: every transaction path in `StorageKnex`,
  `StorageProvider`, `StorageReaderWriter` and the storage methods, plus `KnexSessionManager`,
  `KnexPaymentReplayStore` and `KnexSyncTransferStore`. The results:
  - **No path relies on REPEATABLE READ snapshots or InnoDB gap locks.**
    - Funding (`claimFundingPlan`) and `markChangeInputsSpent` use single conditional `UPDATE ... WHERE
      spentBy IS NULL` statements with an affected-row check. Postgres re-evaluates the `WHERE` against
      the latest row version.
    - Action batch reservation locks rows by primary key, then re-reads, and
      `action_batch_outputs.outputId` is unique.
    - BRC-177 state changes are compare-and-set updates.
    - Sync pages lock the sync state row.
  - **Two paths needed changes on Postgres, both fixed above:**
    - `allocateChangeInput`'s `NOT EXISTS` reservation check used the statement snapshot taken before
      its lock wait.
    - The find-or-insert retry inside a transaction failed with "current transaction is aborted".
      MySQL REPEATABLE READ also cannot see the conflicting row in that retry, so there it failed with
      a duplicate-key error. On Postgres the retry now succeeds.
  - **Unchanged, same on both engines:**
    - Some read-then-write paths without locks: `updateTransactionStatus`, `markUserInputsSpent`,
      `relinquishOutput`, and the proof-request history/notify JSON merges. These behave the same on
      MySQL, where plain reads are also non-locking. The JSON merge race is already repaired by
      `reconcileProvenTxReqTransactions`.
    - `KnexSessionManager.claimMessageNonce` and `claimInitialRequestNonce` catch the duplicate inside
      their transaction. On Postgres the commit becomes a rollback, which discards that transaction's
      expired-row pruning. The returned result is still correct, and pruning runs again on the next
      call.
- **Explicit ids and sequences.** Postgres `serial` sequences do not advance when a row is inserted
  with an explicit id. Production code never inserts explicit ids: sync `mergeNew` resets ids to 0
  before inserting. Only tests do, and the test helper above handles it.

## Compatibility

- No behavior change for SQLite or MySQL. Their statements differ only in identifier quoting, the
  count alias, the session-manager merge expression and the `adminStats` statement shape. Results are
  the same.
- Remote clients older than this release reject `dbtype: 'Postgres'` in settings. A Postgres-backed
  `StorageServer` therefore needs clients on this release or later.
- New public API: the `usePostgresInt8Numbers` export, `Setup.createPostgresKnex`,
  `MonitorDaemonSetup.postgresConnection`, and the optional `dbtype` argument of `KnexMigrations` and
  `setupMigrations`.
