/**
 * Table names for the accounts ledger. These tables are created by the
 * wallet storage implementation (StorageBunSqlite's own migrations), not by
 * the accounts layer itself — keeping the schema a single authority.
 */

export const ACCOUNTS_TABLE = 'accounts'
export const PAYMENTS_TABLE = 'payments'
