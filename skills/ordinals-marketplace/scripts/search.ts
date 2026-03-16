#!/usr/bin/env bun

const API_BASE = 'https://api.1sat.app/1sat'

async function searchByOwner(address: string): Promise<void> {
  console.log(`Fetching ordinals for owner: ${address}\n`)

  const response = await fetch(`${API_BASE}/owner/${address}/txos`)
  if (!response.ok) {
    throw new Error(`API request failed: ${response.statusText}`)
  }

  const results = await response.json()

  if (!Array.isArray(results) || results.length === 0) {
    console.log('No ordinals found for this address.')
    return
  }

  // Filter to ordinal outputs (1 sat with inscription data)
  const ordinals = results.filter(
    (t: any) => t.satoshis === 1 && t.data?.inscription,
  )

  console.log(`Found ${ordinals.length} ordinals:\n`)

  for (const [i, ord] of ordinals.entries()) {
    console.log(`${i + 1}. ${ord.outpoint}`)
    if (ord.data?.inscription?.contentType) {
      console.log(`   Type: ${ord.data.inscription.contentType}`)
    }
    if (ord.data?.map?.name) {
      console.log(`   Name: ${ord.data.map.name}`)
    }
    if (ord.data?.ordlock) {
      const price = ord.data.ordlock.price
      console.log(`   LISTED: ${price} sats (${(price / 1e8).toFixed(8)} BSV)`)
    }
    console.log(`   View: ${API_BASE}/content/${ord.outpoint}`)
    console.log('')
  }
}

const args = process.argv.slice(2)
if (args.length === 0) {
  console.error('Usage: bun run search.ts <owner-address>')
  console.error('')
  console.error('Examples:')
  console.error("  bun run search.ts '1Address...'")
  process.exit(1)
}

searchByOwner(args[0]).catch((e) => {
  console.error('Error:', e.message)
  process.exit(1)
})
