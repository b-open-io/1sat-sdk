/**
 * @1sat/core - Transaction building core for 1Sat Ordinals SDK
 *
 * This package provides:
 * - TxBuilder: Fluent API for building ordinal transactions
 * - High-level functions: createOrdinals, sendOrdinals
 */

// TxBuilder
export { createTxBuilder, TxBuilder, type TxBuilderConfig } from './builder'

// Ordinal operations
export { createOrdinals, sendOrdinals } from './ordinals'
