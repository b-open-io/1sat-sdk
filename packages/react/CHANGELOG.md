# Changelog

## 0.0.9

### Added
- `SigmaCallback` component — generic OAuth callback page for Sigma Identity
- WalletProvider sigma reconnect — on mount, reconnects CWI iframe with stored bapId
- StoredConnection now persists `bapId`, `user`, and `accessToken` for sigma sessions

## 0.0.8

### Breaking Changes
- Removed `OneSatProvider`, `useOneSatContext`, and all popup-specific hooks (`useBalance`, `useOrdinals`, `useTokens`, `useUtxos`, `useSignTransaction`, `useSignMessage`, `useInscribe`, `useSendOrdinals`, `useTransferToken`, `useCreateListing`, `usePurchaseListing`, `useCancelListing`)
- Replaced with BRC-100 standard `WalletProvider` and `useWallet()` hook

### Added
- `WalletProvider` — React context that auto-detects BRC-100 wallets (`window.CWI` from Yours Wallet v4 or any extension) and falls back to configurable providers (1satwallet.com, Sigma Identity)
- `useWallet()` — hook returning `{ wallet: WalletInterface, status, identityKey, providerType, availableProviders, connect, disconnect, error }` as a discriminated union on status
- `WalletSelector` — headless render-prop component for building custom wallet picker UIs
- `ConnectButton` — rewritten for `useWallet()` with render-prop children support
- Auto-reconnect via localStorage persistence
- `@bsv/sdk` added as peer dependency (required for `WalletInterface` type)

### Migration
- Replace `<OneSatProvider>` with `<WalletProvider>`
- Replace `useOneSatContext()` with `useWallet()`
- Use `@1sat/actions` for operations (inscribe, sendBsv, ordinals, etc.) instead of removed hooks
- `wallet` from `useWallet()` is a standard `WalletInterface` from `@bsv/sdk`
