# 1Sat SDK + Yours Wallet QA Checklist

Test app: `bun dev` from `test-1sat-sdk/`

**Stack:** `@1sat/connect` (wallet connection) + `@1sat/react` (React bindings) + `@1sat/actions` (all operations)

## Prerequisites

- [ ] Yours Wallet (Panda Wallet) browser extension installed
- [ ] Extension is unlocked and has a funded wallet
- [ ] Test app running at `http://localhost:5173`

---

## 1. Wallet Connection (`@1sat/connect` via `@1sat/react` WalletProvider)

- [ ] **1.1** Click "Connect Wallet" — Yours Wallet connection prompt appears
- [ ] **1.2** Approve connection — status changes to "connected", identity key displayed
- [ ] **1.3** `getBalance` action runs automatically — satoshis + USD shown
- [ ] **1.4** `getExchangeRate` action runs — BSV/USD rate shown
- [ ] **1.5** Page refresh with `autoReconnect` restores session without re-prompting
- [ ] **1.6** Click "Disconnect" — status returns to "disconnected", wallet info clears
- [ ] **1.7** Connect again after disconnect works without issues

## 2. Balance & UTXOs (`@1sat/actions`: getBalance, getPaymentUtxos, getExchangeRate)

- [ ] **2.1** After connect, balance (satoshis + USD) displayed in Wallet Details
- [ ] **2.2** Click "Refresh" in Payment UTXOs — `getPaymentUtxos` returns list with txid:vout and amounts
- [ ] **2.3** Total satoshis in UTXO list approximately matches displayed balance
- [ ] **2.4** UTXO list scrolls when there are many entries

## 3. Ordinals (`@1sat/actions`: getOrdinals)

- [ ] **3.1** Click "Refresh" in Ordinals panel — `getOrdinals` returns outputs + BEEF
- [ ] **3.2** Outpoints displayed in correct format (txid.vout)
- [ ] **3.3** Spendable/locked status shown per ordinal
- [ ] **3.4** If wallet has no ordinals, panel shows empty state gracefully

## 4. Token Balances (`@1sat/actions`: getBsv21Balances)

- [ ] **4.1** Click "Refresh" in Tokens panel — `getBsv21Balances` loads
- [ ] **4.2** Token symbol, ID, amount, and decimals displayed
- [ ] **4.3** If wallet has BSV21 tokens, balances are aggregated correctly
- [ ] **4.4** If no tokens, empty state shown

## 5. Send BSV (`@1sat/actions`: sendBsv)

- [ ] **5.1** Enter valid destination address and amount
- [ ] **5.2** Click "Send BSV" — wallet approval appears
- [ ] **5.3** Approve — TXID returned and displayed in green
- [ ] **5.4** Verify TXID on WhatsOnChain — transaction is on chain
- [ ] **5.5** Reject in wallet — error displayed, no crash
- [ ] **5.6** Invalid address — error handled gracefully
- [ ] **5.7** Insufficient funds — error message shown
- [ ] **5.8** After send, refreshing UTXOs shows updated balance

## 6. Inscribe (`@1sat/actions`: inscribe)

### 6a. Text Inscription
- [ ] **6.1** Enter text content, select content type (text/plain)
- [ ] **6.2** Click "Inscribe" — wallet approval appears
- [ ] **6.3** Approve — TXID returned
- [ ] **6.4** Verify on WhatsOnChain/1satordinals.com — inscription is on chain
- [ ] **6.5** New ordinal appears in Ordinals list after refresh

### 6b. File Inscription
- [ ] **6.6** Upload a small image file (<100KB)
- [ ] **6.7** Click "Inscribe" — wallet approval appears
- [ ] **6.8** Approve — TXID returned
- [ ] **6.9** Content type auto-detected from file

### 6c. Other Content Types
- [ ] **6.10** Inscribe HTML content (text/html)
- [ ] **6.11** Inscribe JSON content (application/json)

## 7. Send Ordinals (`@1sat/actions`: transferOrdinals)

- [ ] **7.1** Copy an outpoint from the Ordinals list
- [ ] **7.2** Enter destination address
- [ ] **7.3** Click "Send Ordinal" — `getOrdinals` fetches BEEF, then `transferOrdinals` executes
- [ ] **7.4** Approve — TXID returned
- [ ] **7.5** Reject — error shown, no crash
- [ ] **7.6** After send, refreshing Ordinals list no longer shows transferred ordinal

## 8. Transfer Token (`@1sat/actions`: sendBsv21)

- [ ] **8.1** Enter valid token ID, amount, and destination
- [ ] **8.2** Click "Transfer Token" — wallet approval appears
- [ ] **8.3** Approve — TXID returned
- [ ] **8.4** Reject — error shown
- [ ] **8.5** Invalid token ID — error handled

## 9. Marketplace Listings (`@1sat/actions`: listOrdinal, purchaseOrdinal, cancelListing)

### 9a. Create Listing (listOrdinal)
- [ ] **9.1** Enter ordinal outpoint, price, and payment address
- [ ] **9.2** Click "Create Listing" — `getOrdinals` fetches BEEF, then `listOrdinal` executes
- [ ] **9.3** Approve — TXID returned

### 9b. Purchase Listing (purchaseOrdinal)
- [ ] **9.4** Enter listing outpoint
- [ ] **9.5** Click "Purchase Listing" — `purchaseOrdinal` executes
- [ ] **9.6** Approve — TXID returned

### 9c. Cancel Listing (cancelListing)
- [ ] **9.7** Enter listing outpoint
- [ ] **9.8** Click "Cancel Listing" — `getOrdinals` fetches BEEF, then `cancelListing` executes
- [ ] **9.9** Approve — TXID returned

## 10. Sign Message (`@1sat/actions`: signMessage)

- [ ] **10.1** Enter message text
- [ ] **10.2** Click "Sign Message" — wallet approval appears
- [ ] **10.3** Approve — address, pubKey, and signature displayed
- [ ] **10.4** Signature is non-empty and valid-looking
- [ ] **10.5** Reject — error shown, no crash

## 11. Lock BSV (`@1sat/actions`: getLockData, lockBsv, unlockBsv)

- [ ] **11.1** Click "Get Lock Data" — shows locked, unlockable, next unlock block
- [ ] **11.2** Enter amount and block height, click "Lock BSV" — TXID returned
- [ ] **11.3** After locking, "Get Lock Data" shows updated totals
- [ ] **11.4** Click "Unlock Matured" — unlocks any matured locks

## 12. Event Log

- [ ] **12.1** All actions produce log entries naming the `@1sat/actions` function
- [ ] **12.2** Success entries shown in green
- [ ] **12.3** Error entries shown in red
- [ ] **12.4** Info entries shown in blue
- [ ] **12.5** Clear button empties the log
- [ ] **12.6** Log scrolls and stays readable with many entries

## 13. Error Handling & Edge Cases

- [ ] **13.1** Attempting any action while disconnected — buttons disabled
- [ ] **13.2** Closing wallet popup mid-action — timeout/cancelled error
- [ ] **13.3** Rapid button clicks don't cause duplicate transactions (loading state disables button)
- [ ] **13.4** No console errors during normal operation
- [ ] **13.5** Network errors (offline) handled gracefully

## 14. Cross-Browser (Optional)

- [ ] **14.1** Chrome: all features work
- [ ] **14.2** Brave: all features work
- [ ] **14.3** Edge: all features work

---

## Action Coverage Summary

| @1sat/actions Method | UI Panel | Status |
|---------------------|----------|--------|
| `getBalance` | Wallet Info (auto) | |
| `getExchangeRate` | Wallet Info (auto) | |
| `getPaymentUtxos` | Payment UTXOs | |
| `getOrdinals` | Ordinals | |
| `getBsv21Balances` | Token Balances | |
| `sendBsv` | Send BSV | |
| `inscribe` | Inscribe | |
| `transferOrdinals` | Send Ordinals | |
| `sendBsv21` | Transfer Token | |
| `listOrdinal` | Listings > List | |
| `purchaseOrdinal` | Listings > Buy | |
| `cancelListing` | Listings > Cancel | |
| `signMessage` | Sign Message | |
| `getLockData` | Lock BSV | |
| `lockBsv` | Lock BSV | |
| `unlockBsv` | Lock BSV | |
| `sendAllBsv` | — (not tested) | |
| `listTokens` | — (not tested) | |
| `purchaseBsv21` | — (not tested) | |
| `deriveCancelAddress` | — (not tested) | |

## Notes

| Item | Status | Notes |
|------|--------|-------|
| Date tested | | |
| Wallet version | | |
| @1sat/actions version | | |
| @1sat/connect version | | |
| @1sat/react version | | |
| Browser | | |
| Tester | | |
