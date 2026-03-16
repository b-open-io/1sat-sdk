#!/usr/bin/env bun

/**
 * 1sat-stack unified API query examples
 * Demonstrates migration from multiple indexers to single API
 */

const API_BASE = 'https://api.1sat.app/1sat';

interface UnifiedResponse<T> {
  data: T;
  meta: {
    pagination?: {
      page: number;
      limit: number;
      total: number;
    };
    timestamp: string;
  };
}

// Example 1: Get transaction with all overlay data
async function getTransactionComplete(txid: string) {
  console.log(`\n🔍 Fetching complete transaction data for ${txid}`);

  const response = await fetch(`${API_BASE}/tx/${txid}?include=inscriptions,tokens,ordfs`);
  const data: UnifiedResponse<any> = await response.json();

  console.log('\n📄 Transaction:', {
    txid: data.data.txid,
    size: data.data.size,
    fee: data.data.fee,
    blockHeight: data.data.blockHeight,
    inscriptions: data.data.inscriptions?.length || 0,
    tokens: data.data.tokens || null,
    ordfs: data.data.ordfs || null
  });

  return data.data;
}

// Example 2: Search across all data types
async function unifiedSearch(query: string) {
  console.log(`\n🔍 Searching for: ${query}`);

  const response = await fetch(`${API_BASE}/search?q=${encodeURIComponent(query)}`);
  const data: UnifiedResponse<any> = await response.json();

  console.log('\n📊 Search Results:', {
    transactions: data.data.transactions?.length || 0,
    addresses: data.data.addresses?.length || 0,
    blocks: data.data.blocks?.length || 0,
    inscriptions: data.data.inscriptions?.length || 0,
    tokens: data.data.tokens?.length || 0
  });

  return data.data;
}

// Example 3: Get address with all token balances
async function getAddressTokens(address: string) {
  console.log(`\n💰 Fetching token balances for ${address}`);

  const response = await fetch(`${API_BASE}/addresses/${address}/tokens`);
  const data: UnifiedResponse<any> = await response.json();

  if (data.data.length > 0) {
    console.log('\n🪙 Token Balances:');
    data.data.forEach((token: any) => {
      console.log(`  ${token.tick}: ${token.balance} (${token.type})`);
    });
  } else {
    console.log('\n❌ No tokens found');
  }

  return data.data;
}

// Example 4: Get inscription with content
async function getInscriptionContent(inscriptionId: string) {
  console.log(`\n🖼️ Fetching inscription ${inscriptionId}`);

  // Get metadata
  const metaResponse = await fetch(`${API_BASE}/inscriptions/${inscriptionId}`);
  const metadata: UnifiedResponse<any> = await metaResponse.json();

  console.log('\n📋 Inscription Metadata:', {
    id: metadata.data.id,
    contentType: metadata.data.contentType,
    contentLength: metadata.data.contentLength,
    owner: metadata.data.owner
  });

  // Get actual content
  const contentResponse = await fetch(`${API_BASE}/inscriptions/${inscriptionId}/content`);
  if (metadata.data.contentType?.startsWith('text/')) {
    const content = await contentResponse.text();
    console.log('\n📄 Content Preview:', content.substring(0, 200) + '...');
  } else {
    console.log('\n🖼️ Binary content - not displaying');
  }

  return metadata.data;
}

// Example 5: Batch API requests
async function batchRequests(txids: string[]) {
  console.log(`\n📦 Batch fetching ${txids.length} transactions`);

  const response = await fetch(`${API_BASE}/batch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      requests: txids.map(txid => ({
        method: 'GET',
        path: `/tx/${txid}`
      }))
    })
  });

  const data = await response.json();
  console.log(`\n✅ Fetched ${data.responses.length} transactions in one request`);

  return data.responses;
}

// Main execution
async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log(`
Usage:
  bun run query-unified.ts tx <txid>          Get complete transaction data
  bun run query-unified.ts search <query>     Search across all data types
  bun run query-unified.ts tokens <address>   Get address token balances
  bun run query-unified.ts inscription <id>   Get inscription with content
  bun run query-unified.ts batch <txid1,txid2,...>  Batch fetch transactions

Examples:
  bun run query-unified.ts tx abc123def456
  bun run query-unified.ts search "pepe"
  bun run query-unified.ts tokens 1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa
  bun run query-unified.ts inscription 12345678
  bun run query-unified.ts batch tx1,tx2,tx3
`);
    process.exit(1);
  }

  const [command, ...params] = args;

  try {
    switch (command) {
      case 'tx':
        await getTransactionComplete(params[0]);
        break;

      case 'search':
        await unifiedSearch(params.join(' '));
        break;

      case 'tokens':
        await getAddressTokens(params[0]);
        break;

      case 'inscription':
        await getInscriptionContent(params[0]);
        break;

      case 'batch':
        await batchRequests(params[0].split(','));
        break;

      default:
        console.error(`Unknown command: ${command}`);
        process.exit(1);
    }
  } catch (error) {
    console.error('\n❌ Error:', error);
    process.exit(1);
  }
}

main();