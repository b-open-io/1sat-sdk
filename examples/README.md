# 1Sat SDK Examples

## Browser

A simple HTML page demonstrating wallet connection and basic operations.

```bash
# Serve the examples directory
bunx serve examples/browser
```

Open http://localhost:3000 in your browser.

## React

A React app with hooks and ConnectButton component.

```bash
# Create a new React app
bunx create-vite my-app --template react-ts
cd my-app

# Install dependencies
bun add @1sat/react @bsv/sdk

# Copy the example App.tsx
cp ../examples/react/App.tsx src/App.tsx

# Run
bun dev
```

## Server

Server-side scripts for backends or CLI tools. These use private keys directly.

### Inscribe Text

```bash
WALLET_WIF=your-private-key bun run examples/server/inscribe.ts
```

### Transfer Tokens

```bash
PAYMENT_WIF=... ORD_WIF=... TOKEN_ID=txid_0 RECIPIENT=address AMOUNT=100 \
  bun run examples/server/token-transfer.ts
```

### List Ordinal for Sale

```bash
PAYMENT_WIF=... ORD_WIF=... OUTPOINT=txid_0 PRICE=10000 \
  bun run examples/server/list-ordinal.ts
```
