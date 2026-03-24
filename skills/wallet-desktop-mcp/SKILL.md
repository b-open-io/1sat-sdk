---
name: wallet-desktop-mcp
description: Control the running 1Sat desktop wallet via MCP. Use this proactively whenever the user mentions their wallet, BSV balance, ordinals, inscriptions, tokens, sending BSV, browsing the 1Sat app, or any blockchain task that could be done through the wallet UI. The 1sat plugin ships .mcp.json automatically — if the plugin is installed and the wallet app is running, tools are available immediately with no manual setup. Requires the 1Sat wallet-desktop app to be running.
---

# 1Sat Wallet Desktop — MCP Server

The 1Sat desktop wallet exposes an MCP server on `127.0.0.1:3322` when running. It provides 25 tools for browser automation, blockchain data queries, and wallet operations. Authentication is handled automatically by `1sat mcp-proxy`.

## Zero-Config Setup (Plugin Users)

If the 1sat Claude Code plugin is installed, the `.mcp.json` is already configured. No manual steps — install the CLI, launch the wallet, MCP tools appear automatically.

## Getting Started

1. **Install the 1Sat CLI globally:**
   ```bash
   bun install -g @1sat/cli
   ```

2. **Launch the 1Sat wallet desktop app.** The MCP server starts on `127.0.0.1:3322` automatically.

3. **MCP tools appear in Claude Code.** The 1sat plugin ships `.mcp.json`. Restart Claude Code to pick it up.

   Verify the server is reachable:
   ```bash
   curl -s http://127.0.0.1:3322/
   ```
   Expected: `{"name":"1sat-browser","version":"0.0.1","transport":"streamable-http","auth":"brc-31"}`

## The `1sat mcp-proxy` Command

The `.mcp.json` runs `1sat mcp-proxy`. This command:
- Bridges stdin/stdout (MCP protocol) to the wallet's HTTP server
- Handles BRC-103/104 authentication automatically
- Generates and stores identity keys on first run at `~/.1sat-wallet/mcp-agent.key`

For manual testing: `1sat mcp-proxy`

## Common Agent Workflows

### Check balance then send BSV
1. `wallet_balance` — get current balance
2. `wallet_send_bsv` — send to recipient
3. `wallet_balance` — confirm new balance

### Browse ordinals and inspect an inscription
1. `wallet_ordinals` — list owned ordinals
2. `inscription_metadata` — get full metadata for an inscription
3. `browser_navigate` with `1sat://ordinals/gallery` — open visual gallery

### Token portfolio and marketplace
1. `wallet_tokens` — list owned BSV-21 tokens
2. `token_balances` — balance for a specific ticker
3. `marketplace_listings` — current OrdLock listings

### Open a wallet page
`browser_navigate` with any `1sat://` URL:
- `1sat://wallet/send` — send flow
- `1sat://ordinals/gallery` — collection
- `1sat://identity/profile` — BAP identity

### Read page content
1. `browser_navigate` — load a page
2. `browser_get_page_text` — extract text
3. `browser_execute_js` — deeper inspection

## Available Tools

### Browser Control
| Tool | Description |
|------|-------------|
| `browser_open` | Open a URL in a new browser window |
| `browser_close` | Close a browser window |
| `browser_list_windows` | List all open browser windows |
| `browser_navigate` | Navigate current window to a URL |
| `browser_go_back` | Go back in browser history |
| `browser_go_forward` | Go forward in browser history |
| `browser_execute_js` | Execute JavaScript in the browser context |
| `browser_get_page_text` | Get the text content of the current page |

### Tab Management
| Tool | Description |
|------|-------------|
| `tab_list` | List all open tabs |
| `tab_create` | Create a new tab |
| `tab_close` | Close a tab |
| `tab_navigate` | Navigate a tab to a URL |
| `tab_activate` | Switch to a tab |
| `tab_go_back` | Go back in a tab's history |
| `tab_reload` | Reload a tab |

### Blockchain Data
| Tool | Description |
|------|-------------|
| `inscription_metadata` | Get metadata for an inscription (via ORDFS) |
| `marketplace_listings` | Query OrdLock marketplace listings |
| `token_balances` | Get BSV-21 token balances |
| `listing_lookup` | Look up a specific marketplace listing |

### Wallet Operations
| Tool | Description |
|------|-------------|
| `wallet_status` | Get wallet lock/unlock status |
| `wallet_balance` | Get BSV balance |
| `wallet_identity` | Get the wallet's BAP identity |
| `wallet_ordinals` | List owned ordinals/inscriptions |
| `wallet_tokens` | List owned BSV-21 tokens |
| `wallet_send_bsv` | Send BSV to an address |

## Internal URLs

- `1sat://wallet/overview` — wallet dashboard
- `1sat://wallet/send` — send BSV flow
- `1sat://wallet/receive` — receive address + QR
- `1sat://wallet/history` — transaction history
- `1sat://ordinals/gallery` — ordinals collection
- `1sat://tokens/all` — token portfolio
- `1sat://identity/profile` — BAP identity
- `1sat://settings` — app settings
- `1sat://social/feed` — BSV social timeline
- `1sat://chat` — messaging
