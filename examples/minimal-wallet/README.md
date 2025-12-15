# Minimal Wallet Example

A minimal browser wallet extension demonstrating `@1sat/extension`.

## Features

- Single-key wallet (auto-generated on first use)
- Connect approval popup
- Sign message approval popup
- Balance display via WhatsOnChain API
- Connected sites management

## Setup

1. Install dependencies:

```bash
cd examples/minimal-wallet
bun install
```

2. Add icons to `public/`:
   - `icon16.png` (16x16)
   - `icon48.png` (48x48)
   - `icon128.png` (128x128)

3. Build:

```bash
bun run dev
```

4. Load in Chrome:
   - Open `chrome://extensions`
   - Enable "Developer mode"
   - Click "Load unpacked"
   - Select the `dist` folder

## Architecture

```
src/
├── inject.ts     # Injects window.onesat provider into pages
├── content.ts    # Bridges page ↔ background communication
├── background.ts # Wallet logic (keys, signing, API calls)
└── popup.ts      # Shared popup utilities

popup/
├── index.html    # Main popup (balance, connected sites)
├── connect.html  # Connection approval popup
└── sign.html     # Message signing approval popup
```

## Usage

Once loaded, any page can use the wallet:

```javascript
// Check if extension is available
if (window.onesat) {
  // Connect
  const { paymentAddress } = await window.onesat.connect()
  console.log('Connected:', paymentAddress)

  // Sign message
  const result = await window.onesat.signMessage('Hello, wallet!')
  console.log('Signature:', result.sig)

  // Get balance
  const { satoshis } = await window.onesat.getBalance()
  console.log('Balance:', satoshis, 'sats')
}
```

## Testing

Open the browser console on any page and try:

```javascript
// Connect
await window.onesat.connect()

// Sign
await window.onesat.signMessage('test message')

// Balance
await window.onesat.getBalance()

// Disconnect
await window.onesat.disconnect()
```

## Notes

- Private key is stored in `chrome.storage.local` (unencrypted for demo purposes)
- Uses WhatsOnChain API for balance/UTXO queries
- No transaction signing implemented (just message signing)
- For production, add proper key encryption and more features
