-- Converts a StoragePg wallet database (1sat-sdk/packages/wallet-node/src/storage-pg.ts, all 22
-- StoragePg migrations applied) to the schema StorageKnex builds on Postgres
-- (@bsv/wallet-toolbox with Postgres support, migrations up to 2026-09-16-001).
--
-- Usage (wallet server stopped, run as the role that owns the tables):
--   psql "$DB_URL" -v ON_ERROR_STOP=1 -f 2026-10-01-storagepg-to-storageknex.sql
--
-- Everything up to COMMIT runs in one transaction; any error rolls the database back unchanged.
-- Re-running on a converted database changes nothing.
--
-- Afterwards StorageKnex.migrate applies the 8 toolbox migrations StoragePg never had (7 new tables
-- and the managed-change basket default update). It runs when the wallet server starts.
--
-- Kept on purpose: the unique index sync_states_user_storage_identity ("userId",
-- "storageIdentityKey") from StoragePg migration 2026-09-30-001. StorageKnex does not create it;
-- it turns the findOrInsertSyncStateAuth insert race into a retried constraint error.

\set ON_ERROR_STOP on

BEGIN;

-- Fail instead of queueing behind a client that is still connected.
SET LOCAL lock_timeout = '10s';

-- Refuse to touch anything that is not a StoragePg or already-converted StorageKnex database.
DO $$
DECLARE
  unknown text;
BEGIN
  IF to_regclass('knex_migrations') IS NULL OR to_regclass('settings') IS NULL THEN
    RAISE EXCEPTION 'not a wallet storage database: knex_migrations or settings missing';
  END IF;
  SELECT string_agg(name, ', ') INTO unknown FROM knex_migrations WHERE name NOT IN (
    '2024-12-26-001 initial migration',
    '2025-01-21-001 add activeStorage to users',
    '2025-02-22-001 nonNULL activeStorage',
    '2025-02-28-001 derivations to 200',
    '2025-03-01-001 reset req history',
    '2025-03-03-001 descriptions to 2000',
    '2025-05-13-001 add monitor events event index',
    '2025-09-06-001 add proven txs blockHash index',
    '2025-10-13-001 add outputs spendable index',
    '2025-10-18-001 add transactions txid index',
    '2025-10-18-002 add proven_tx_reqs txid index',
    '2026-02-27-001 add listOutputs path indexes',
    '2026-02-27-002 add createAction path indexes',
    '2026-04-20-001 add transactions userId index',
    '2026-04-20-002 add outputs userId index',
    '2026-04-30-001 add wasBroadcast and rebroadcastAttempts to proven_tx_reqs',
    '2026-07-14-001 add shared auth sessions',
    '2026-07-14-002 add monitor created index',
    '2026-07-15-001 add action batch reservations and blobs',
    '2026-07-26-001 retain prepared action batch manifests',
    '2026-08-02-001 add createAction funding selection index',
    '2026-08-04-001 add payment replay claims',
    '2026-08-10-001 upgrade managed change liquidity defaults',
    '2026-08-17-001 add wallet sync source indexes',
    '2026-08-30-001 add brc177 nosend expiry state',
    '2026-08-31-001 add prepared beef artifacts',
    '2026-09-09-001 add bounded sync transfers',
    '2026-09-16-001 add auth message replay claims',
    '2026-09-30-001 unique sync state per storage identity',
    '2026-09-30-002 re-file legacy p 1sat baskets');
  IF unknown IS NOT NULL THEN
    RAISE EXCEPTION 'unexpected knex_migrations rows: %', unknown;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM knex_migrations WHERE name = '2026-08-30-001 add brc177 nosend expiry state') THEN
    RAISE EXCEPTION 'StoragePg migrations are not current; start the StoragePg server once first';
  END IF;
END $$;

-- Column changes are queued per table and applied as one ALTER TABLE each, so every table is
-- rewritten at most once.
CREATE TEMP TABLE _alter (ord serial, tbl text, clause text) ON COMMIT DROP;

-- Queues the changes that make column tbl.col match type/default/nullability. The current type
-- and default are compared as format_type / pg_get_expr print them.
--   smallint -> boolean:    col <> 0
--   timestamptz -> (3):     truncated to the millisecond, the value clients already received
--                           (node-postgres drops sub-millisecond digits)
--   text -> varchar(n):     assignment cast; a value longer than n aborts the transaction
--   bigint -> integer:      assignment cast; an out-of-range value aborts the transaction
CREATE FUNCTION pg_temp.col(tbl text, col text, typ text, dflt text, not_null boolean) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  cur_type text;
  cur_dflt text;
  cur_notnull boolean;
  using_expr text := '';
BEGIN
  SELECT format_type(a.atttypid, a.atttypmod), pg_get_expr(d.adbin, d.adrelid), a.attnotnull
    INTO cur_type, cur_dflt, cur_notnull
    FROM pg_attribute a
    LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
   WHERE a.attrelid = format('%I', tbl)::regclass AND a.attname = col AND NOT a.attisdropped;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'column %.% not found', tbl, col;
  END IF;

  IF cur_type <> typ THEN
    IF cur_type = 'smallint' AND typ = 'boolean' THEN
      using_expr := format(' USING %I <> 0', col);
    ELSIF cur_type = 'timestamp with time zone' AND typ = 'timestamp(3) with time zone' THEN
      using_expr := format(' USING date_trunc(''milliseconds'', %I)', col);
    END IF;
    IF cur_dflt IS NOT NULL THEN
      INSERT INTO _alter (tbl, clause) VALUES (tbl, format('ALTER COLUMN %I DROP DEFAULT', col));
    END IF;
    INSERT INTO _alter (tbl, clause) VALUES (tbl, format('ALTER COLUMN %I TYPE %s%s', col, typ, using_expr));
    IF dflt IS NOT NULL THEN
      INSERT INTO _alter (tbl, clause) VALUES (tbl, format('ALTER COLUMN %I SET DEFAULT %s', col, dflt));
    END IF;
  ELSIF cur_dflt IS DISTINCT FROM dflt THEN
    INSERT INTO _alter (tbl, clause) VALUES (tbl,
      CASE WHEN dflt IS NULL THEN format('ALTER COLUMN %I DROP DEFAULT', col)
           ELSE format('ALTER COLUMN %I SET DEFAULT %s', col, dflt) END);
  END IF;

  IF cur_notnull <> not_null THEN
    INSERT INTO _alter (tbl, clause) VALUES (tbl,
      format('ALTER COLUMN %I %s NOT NULL', col, CASE WHEN not_null THEN 'SET' ELSE 'DROP' END));
  END IF;
END $$;

-- created_at / updated_at exist on every StorageKnex table built by addTimeStamps.
CREATE FUNCTION pg_temp.timestamps(tbl text) RETURNS void LANGUAGE sql AS $$
  SELECT pg_temp.col(tbl, 'created_at', 'timestamp(3) with time zone', 'CURRENT_TIMESTAMP', true);
  SELECT pg_temp.col(tbl, 'updated_at', 'timestamp(3) with time zone', 'CURRENT_TIMESTAMP', true);
$$;

CREATE FUNCTION pg_temp.apply_alters() RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  r record;
  t timestamptz;
BEGIN
  FOR r IN SELECT tbl, string_agg(clause, ', ' ORDER BY ord) AS clauses
             FROM _alter GROUP BY tbl ORDER BY min(ord) LOOP
    t := clock_timestamp();
    EXECUTE format('ALTER TABLE %I %s', r.tbl, r.clauses);
    RAISE NOTICE 'altered % in % ms', r.tbl,
      round(extract(epoch FROM clock_timestamp() - t) * 1000);
  END LOOP;
  DELETE FROM _alter;
END $$;

-- Replaces an identity column with a serial default on the sequence name knex creates
-- ("<table>_<column>_seq"). The new sequence continues from the identity sequence.
CREATE FUNCTION pg_temp.identity_to_serial(tbl text, col text) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  seq text := format('%s_%s_seq', tbl, col);
  identity_seq text;
  last_used bigint;
  max_id bigint;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = format('%I', tbl)::regclass
                  AND attname = col AND attidentity <> '') THEN
    RETURN;
  END IF;
  identity_seq := pg_get_serial_sequence(format('%I', tbl), col);
  EXECUTE format('SELECT CASE WHEN is_called THEN last_value ELSE last_value - 1 END FROM %s', identity_seq)
    INTO last_used;
  EXECUTE format('SELECT max(%I) FROM %I', col, tbl) INTO max_id;
  EXECUTE format('ALTER TABLE %I ALTER COLUMN %I DROP IDENTITY', tbl, col);
  EXECUTE format('CREATE SEQUENCE %I AS integer OWNED BY %I.%I', seq, tbl, col);
  EXECUTE format('ALTER TABLE %I ALTER COLUMN %I SET DEFAULT nextval(%L::regclass)', tbl, col, quote_ident(seq));
  IF greatest(last_used, max_id, 0) > 0 THEN
    PERFORM setval(quote_ident(seq), greatest(last_used, max_id));
  END IF;
END $$;

CREATE FUNCTION pg_temp.rename_constraint(tbl text, old_name text, new_name text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = format('%I', tbl)::regclass AND conname = old_name) THEN
    EXECUTE format('ALTER TABLE %I RENAME CONSTRAINT %I TO %I', tbl, old_name, new_name);
  END IF;
END $$;

CREATE FUNCTION pg_temp.rename_index(old_name text, new_name text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF to_regclass(format('%I', old_name)) IS NOT NULL THEN
    EXECUTE format('ALTER INDEX %I RENAME TO %I', old_name, new_name);
  END IF;
END $$;

-- 1. Column types, defaults and nullability.
DO $$
BEGIN
  PERFORM pg_temp.col('proven_txs', 'txid', 'character varying(64)', NULL, true);
  PERFORM pg_temp.col('proven_txs', 'blockHash', 'character varying(64)', NULL, true);
  PERFORM pg_temp.col('proven_txs', 'merkleRoot', 'character varying(64)', NULL, true);
  PERFORM pg_temp.timestamps('proven_txs');

  PERFORM pg_temp.col('proven_tx_reqs', 'status', 'character varying(16)', '''unknown''::character varying', true);
  PERFORM pg_temp.col('proven_tx_reqs', 'txid', 'character varying(64)', NULL, true);
  PERFORM pg_temp.col('proven_tx_reqs', 'batch', 'character varying(64)', NULL, false);
  PERFORM pg_temp.col('proven_tx_reqs', 'notified', 'boolean', 'false', true);
  PERFORM pg_temp.col('proven_tx_reqs', 'wasBroadcast', 'boolean', 'false', true);
  PERFORM pg_temp.timestamps('proven_tx_reqs');

  PERFORM pg_temp.col('users', 'identityKey', 'character varying(130)', NULL, true);
  PERFORM pg_temp.col('users', 'activeStorage', 'character varying(255)', NULL, true);
  PERFORM pg_temp.timestamps('users');

  PERFORM pg_temp.col('certificates', 'type', 'character varying(100)', NULL, true);
  PERFORM pg_temp.col('certificates', 'serialNumber', 'character varying(100)', NULL, true);
  PERFORM pg_temp.col('certificates', 'certifier', 'character varying(100)', NULL, true);
  PERFORM pg_temp.col('certificates', 'subject', 'character varying(100)', NULL, true);
  PERFORM pg_temp.col('certificates', 'verifier', 'character varying(100)', NULL, false);
  PERFORM pg_temp.col('certificates', 'revocationOutpoint', 'character varying(100)', NULL, true);
  PERFORM pg_temp.col('certificates', 'signature', 'character varying(255)', NULL, true);
  PERFORM pg_temp.col('certificates', 'isDeleted', 'boolean', 'false', true);
  PERFORM pg_temp.timestamps('certificates');

  PERFORM pg_temp.col('certificate_fields', 'fieldName', 'character varying(100)', NULL, true);
  PERFORM pg_temp.col('certificate_fields', 'fieldValue', 'character varying(255)', NULL, true);
  PERFORM pg_temp.col('certificate_fields', 'masterKey', 'character varying(255)', '''''::character varying', true);
  PERFORM pg_temp.timestamps('certificate_fields');

  PERFORM pg_temp.col('output_baskets', 'name', 'character varying(300)', NULL, true);
  PERFORM pg_temp.col('output_baskets', 'numberOfDesiredUTXOs', 'integer', '144', true);
  PERFORM pg_temp.col('output_baskets', 'minimumDesiredUTXOValue', 'integer', '5000', true);
  PERFORM pg_temp.col('output_baskets', 'isDeleted', 'boolean', 'false', true);
  PERFORM pg_temp.timestamps('output_baskets');

  PERFORM pg_temp.col('transactions', 'status', 'character varying(64)', NULL, true);
  PERFORM pg_temp.col('transactions', 'reference', 'character varying(64)', NULL, true);
  PERFORM pg_temp.col('transactions', 'isOutgoing', 'boolean', NULL, true);
  PERFORM pg_temp.col('transactions', 'satoshis', 'bigint', '''0''::bigint', true);
  PERFORM pg_temp.col('transactions', 'description', 'character varying(2048)', NULL, false);
  PERFORM pg_temp.col('transactions', 'txid', 'character varying(64)', NULL, false);
  PERFORM pg_temp.col('transactions', 'noSendExpiryMode', 'character varying(16)', NULL, false);
  PERFORM pg_temp.col('transactions', 'noSendExpiryState', 'character varying(24)', NULL, false);
  PERFORM pg_temp.col('transactions', 'noSendExpiryAnchorTxid', 'character varying(64)', NULL, false);
  PERFORM pg_temp.col('transactions', 'noSendExpiryReclaimTxid', 'character varying(64)', NULL, false);
  PERFORM pg_temp.col('transactions', 'noSendExpiryReclaimDerivationPrefix', 'character varying(32)', NULL, false);
  PERFORM pg_temp.col('transactions', 'noSendExpiryReclaimDerivationSuffix', 'character varying(32)', NULL, false);
  PERFORM pg_temp.timestamps('transactions');

  PERFORM pg_temp.col('commissions', 'satoshis', 'integer', NULL, true);
  PERFORM pg_temp.col('commissions', 'keyOffset', 'character varying(130)', NULL, true);
  PERFORM pg_temp.col('commissions', 'isRedeemed', 'boolean', 'false', true);
  PERFORM pg_temp.timestamps('commissions');

  PERFORM pg_temp.col('outputs', 'spendable', 'boolean', 'false', true);
  PERFORM pg_temp.col('outputs', 'change', 'boolean', 'false', true);
  PERFORM pg_temp.col('outputs', 'outputDescription', 'character varying(2048)', NULL, false);
  PERFORM pg_temp.col('outputs', 'type', 'character varying(50)', NULL, true);
  PERFORM pg_temp.col('outputs', 'providedBy', 'character varying(130)', NULL, true);
  PERFORM pg_temp.col('outputs', 'purpose', 'character varying(20)', NULL, true);
  PERFORM pg_temp.col('outputs', 'txid', 'character varying(64)', NULL, false);
  PERFORM pg_temp.col('outputs', 'senderIdentityKey', 'character varying(130)', NULL, false);
  PERFORM pg_temp.col('outputs', 'derivationPrefix', 'character varying(200)', NULL, false);
  PERFORM pg_temp.col('outputs', 'derivationSuffix', 'character varying(200)', NULL, false);
  PERFORM pg_temp.col('outputs', 'customInstructions', 'character varying(2500)', NULL, false);
  PERFORM pg_temp.col('outputs', 'spendingDescription', 'character varying(2048)', NULL, false);
  PERFORM pg_temp.timestamps('outputs');

  PERFORM pg_temp.col('output_tags', 'tag', 'character varying(150)', NULL, true);
  PERFORM pg_temp.col('output_tags', 'isDeleted', 'boolean', 'false', true);
  PERFORM pg_temp.timestamps('output_tags');

  PERFORM pg_temp.col('output_tags_map', 'isDeleted', 'boolean', 'false', true);
  PERFORM pg_temp.timestamps('output_tags_map');

  PERFORM pg_temp.col('tx_labels', 'label', 'character varying(300)', NULL, true);
  PERFORM pg_temp.col('tx_labels', 'isDeleted', 'boolean', 'false', true);
  PERFORM pg_temp.timestamps('tx_labels');

  PERFORM pg_temp.col('tx_labels_map', 'isDeleted', 'boolean', 'false', true);
  PERFORM pg_temp.timestamps('tx_labels_map');

  PERFORM pg_temp.col('monitor_events', 'event', 'character varying(64)', NULL, true);
  PERFORM pg_temp.timestamps('monitor_events');

  PERFORM pg_temp.col('settings', 'storageIdentityKey', 'character varying(130)', NULL, true);
  PERFORM pg_temp.col('settings', 'storageName', 'character varying(128)', NULL, true);
  PERFORM pg_temp.col('settings', 'chain', 'character varying(10)', NULL, true);
  PERFORM pg_temp.col('settings', 'dbtype', 'character varying(10)', NULL, true);
  PERFORM pg_temp.timestamps('settings');

  PERFORM pg_temp.col('sync_states', 'storageIdentityKey', 'character varying(130)', '''''::character varying', true);
  PERFORM pg_temp.col('sync_states', 'storageName', 'character varying(255)', NULL, true);
  PERFORM pg_temp.col('sync_states', 'status', 'character varying(255)', '''unknown''::character varying', true);
  PERFORM pg_temp.col('sync_states', 'init', 'boolean', 'false', true);
  PERFORM pg_temp.col('sync_states', 'refNum', 'character varying(100)', NULL, true);
  PERFORM pg_temp.timestamps('sync_states');

  PERFORM pg_temp.apply_alters();
END $$;

-- 2. Identity primary keys become serial columns.
DO $$
BEGIN
  PERFORM pg_temp.identity_to_serial('proven_txs', 'provenTxId');
  PERFORM pg_temp.identity_to_serial('proven_tx_reqs', 'provenTxReqId');
  PERFORM pg_temp.identity_to_serial('users', 'userId');
  PERFORM pg_temp.identity_to_serial('certificates', 'certificateId');
  PERFORM pg_temp.identity_to_serial('output_baskets', 'basketId');
  PERFORM pg_temp.identity_to_serial('transactions', 'transactionId');
  PERFORM pg_temp.identity_to_serial('commissions', 'commissionId');
  PERFORM pg_temp.identity_to_serial('outputs', 'outputId');
  PERFORM pg_temp.identity_to_serial('output_tags', 'outputTagId');
  PERFORM pg_temp.identity_to_serial('tx_labels', 'txLabelId');
  PERFORM pg_temp.identity_to_serial('monitor_events', 'id');
  PERFORM pg_temp.identity_to_serial('sync_states', 'syncStateId');
END $$;

-- 3. Indexes: drop the StoragePg-only userId indexes (each is the leading column of a composite
--    index StorageKnex creates: idx_outputs_user_spendable_outputid, idx_transactions_user_proven_tx)
--    and rename the rest to knex's default names.
DROP INDEX IF EXISTS outputs_userid;
DROP INDEX IF EXISTS transactions_userid;

DO $$
BEGIN
  PERFORM pg_temp.rename_index('commissions_transactionid', 'commissions_transactionid_index');
  PERFORM pg_temp.rename_index('monitor_events_event', 'monitor_events_event_index');
  PERFORM pg_temp.rename_index('output_tags_map_outputid', 'output_tags_map_outputid_index');
  PERFORM pg_temp.rename_index('outputs_spendable', 'outputs_spendable_index');
  PERFORM pg_temp.rename_index('proven_tx_reqs_batch', 'proven_tx_reqs_batch_index');
  PERFORM pg_temp.rename_index('proven_tx_reqs_status', 'proven_tx_reqs_status_index');
  PERFORM pg_temp.rename_index('proven_tx_reqs_txid', 'proven_tx_reqs_txid_index');
  PERFORM pg_temp.rename_index('proven_txs_blockhash', 'proven_txs_blockhash_index');
  PERFORM pg_temp.rename_index('sync_states_refnum', 'sync_states_refnum_index');
  PERFORM pg_temp.rename_index('sync_states_status', 'sync_states_status_index');
  PERFORM pg_temp.rename_index('transactions_status', 'transactions_status_index');
  PERFORM pg_temp.rename_index('transactions_txid', 'transactions_txid_index');
  PERFORM pg_temp.rename_index('tx_labels_map_transactionid', 'tx_labels_map_transactionid_index');
END $$;

-- 4. Unique and foreign key constraints get knex's default names (renaming a unique constraint
--    renames its index).
DO $$
BEGIN
  PERFORM pg_temp.rename_constraint('proven_txs', 'proven_txs_txid_key', 'proven_txs_txid_unique');
  PERFORM pg_temp.rename_constraint('proven_tx_reqs', 'proven_tx_reqs_txid_key', 'proven_tx_reqs_txid_unique');
  PERFORM pg_temp.rename_constraint('proven_tx_reqs', 'proven_tx_reqs_provenTxId_fkey', 'proven_tx_reqs_proventxid_foreign');
  PERFORM pg_temp.rename_constraint('users', 'users_identityKey_key', 'users_identitykey_unique');
  PERFORM pg_temp.rename_constraint('certificates', 'certificates_userId_fkey', 'certificates_userid_foreign');
  PERFORM pg_temp.rename_constraint('certificates', 'certificates_userId_type_certifier_serialNumber_key', 'certificates_userid_type_certifier_serialnumber_unique');
  PERFORM pg_temp.rename_constraint('certificate_fields', 'certificate_fields_userId_fkey', 'certificate_fields_userid_foreign');
  PERFORM pg_temp.rename_constraint('certificate_fields', 'certificate_fields_certificateId_fkey', 'certificate_fields_certificateid_foreign');
  PERFORM pg_temp.rename_constraint('certificate_fields', 'certificate_fields_fieldName_certificateId_key', 'certificate_fields_fieldname_certificateid_unique');
  PERFORM pg_temp.rename_constraint('output_baskets', 'output_baskets_userId_fkey', 'output_baskets_userid_foreign');
  PERFORM pg_temp.rename_constraint('output_baskets', 'output_baskets_name_userId_key', 'output_baskets_name_userid_unique');
  PERFORM pg_temp.rename_constraint('transactions', 'transactions_userId_fkey', 'transactions_userid_foreign');
  PERFORM pg_temp.rename_constraint('transactions', 'transactions_provenTxId_fkey', 'transactions_proventxid_foreign');
  PERFORM pg_temp.rename_constraint('transactions', 'transactions_reference_key', 'transactions_reference_unique');
  PERFORM pg_temp.rename_constraint('commissions', 'commissions_userId_fkey', 'commissions_userid_foreign');
  PERFORM pg_temp.rename_constraint('commissions', 'commissions_transactionId_fkey', 'commissions_transactionid_foreign');
  PERFORM pg_temp.rename_constraint('commissions', 'commissions_transactionId_key', 'commissions_transactionid_unique');
  PERFORM pg_temp.rename_constraint('outputs', 'outputs_userId_fkey', 'outputs_userid_foreign');
  PERFORM pg_temp.rename_constraint('outputs', 'outputs_transactionId_fkey', 'outputs_transactionid_foreign');
  PERFORM pg_temp.rename_constraint('outputs', 'outputs_basketId_fkey', 'outputs_basketid_foreign');
  PERFORM pg_temp.rename_constraint('outputs', 'outputs_spentBy_fkey', 'outputs_spentby_foreign');
  PERFORM pg_temp.rename_constraint('outputs', 'outputs_transactionId_vout_userId_key', 'outputs_transactionid_vout_userid_unique');
  PERFORM pg_temp.rename_constraint('output_tags', 'output_tags_userId_fkey', 'output_tags_userid_foreign');
  PERFORM pg_temp.rename_constraint('output_tags', 'output_tags_tag_userId_key', 'output_tags_tag_userid_unique');
  PERFORM pg_temp.rename_constraint('output_tags_map', 'output_tags_map_outputTagId_fkey', 'output_tags_map_outputtagid_foreign');
  PERFORM pg_temp.rename_constraint('output_tags_map', 'output_tags_map_outputId_fkey', 'output_tags_map_outputid_foreign');
  PERFORM pg_temp.rename_constraint('output_tags_map', 'output_tags_map_outputTagId_outputId_key', 'output_tags_map_outputtagid_outputid_unique');
  PERFORM pg_temp.rename_constraint('tx_labels', 'tx_labels_userId_fkey', 'tx_labels_userid_foreign');
  PERFORM pg_temp.rename_constraint('tx_labels', 'tx_labels_label_userId_key', 'tx_labels_label_userid_unique');
  PERFORM pg_temp.rename_constraint('tx_labels_map', 'tx_labels_map_txLabelId_fkey', 'tx_labels_map_txlabelid_foreign');
  PERFORM pg_temp.rename_constraint('tx_labels_map', 'tx_labels_map_transactionId_fkey', 'tx_labels_map_transactionid_foreign');
  PERFORM pg_temp.rename_constraint('tx_labels_map', 'tx_labels_map_txLabelId_transactionId_key', 'tx_labels_map_txlabelid_transactionid_unique');
  PERFORM pg_temp.rename_constraint('sync_states', 'sync_states_userId_fkey', 'sync_states_userid_foreign');
  PERFORM pg_temp.rename_constraint('sync_states', 'sync_states_refNum_key', 'sync_states_refnum_unique');
END $$;

-- 5. Migration journal: StorageKnex refuses to run while names it does not know are present.
DELETE FROM knex_migrations WHERE name IN (
  '2026-04-20-001 add transactions userId index',
  '2026-04-20-002 add outputs userId index',
  '2026-09-30-001 unique sync state per storage identity',
  '2026-09-30-002 re-file legacy p 1sat baskets');
UPDATE knex_migrations_lock SET is_locked = 0 WHERE is_locked <> 0;

-- 6. Settings.
UPDATE settings SET dbtype = 'Postgres' WHERE dbtype IS DISTINCT FROM 'Postgres';

-- 7. Every sequence owned by a column continues past both its own position and max(column).
DO $$
DECLARE
  r record;
  last_used bigint;
  max_id bigint;
BEGIN
  FOR r IN SELECT s.oid::regclass::text AS seq, t.relname AS tbl, a.attname AS col
             FROM pg_class s
             JOIN pg_depend dp ON dp.objid = s.oid AND dp.classid = 'pg_class'::regclass AND dp.deptype = 'a'
             JOIN pg_class t ON t.oid = dp.refobjid
             JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = dp.refobjsubid
            WHERE s.relkind = 'S' AND s.relnamespace = current_schema()::regnamespace LOOP
    EXECUTE format('SELECT CASE WHEN is_called THEN last_value ELSE last_value - 1 END FROM %s', r.seq)
      INTO last_used;
    EXECUTE format('SELECT max(%I) FROM %I', r.col, r.tbl) INTO max_id;
    IF coalesce(max_id, 0) > last_used THEN
      PERFORM setval(r.seq, max_id);
      RAISE NOTICE 'sequence % advanced to %', r.seq, max_id;
    END IF;
  END LOOP;
END $$;

COMMIT;

-- Type changes drop the planner statistics of the changed columns.
ANALYZE;
