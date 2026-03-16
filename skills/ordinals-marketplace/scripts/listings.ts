#!/usr/bin/env bun

const API_BASE = 'https://api.1sat.app/1sat'

async function getListings(address: string): Promise<void> {
  console.log(`Fetching listed ordinals for: ${address}\n`)

  const response = await fetch(`${API_BASE}/owner/${address}/txos`)
  if (!response.ok) {
    throw new Error(`API request failed: ${response.statusText}`)
  }

  const results = await response.json()

  if (!Array.isArray(results) || results.length === 0) {
    console.log('No ordinals found for this address.')
    return
  }

  // Filter to listed ordinals (have ordlock data)
  const listings = results.filter((t: any) => t.data?.ordlock)

  if (listings.length === 0) {
    console.log('No active listings found.')
    return
  }

  console.log(`Active Listings (${listings.length}):\n`)

  for (const [i, listing] of listings.entries()) {
    const price = listing.data.ordlock.price
    console.log(`${i + 1}. ${listing.outpoint}`)
    console.log(`   Price: ${price} sats (${(price / 1e8).toFixed(8)} BSV)`)
    if (listing.data?.inscription?.contentType) {
      console.log(`   Type: ${listing.data.inscription.contentType}`)
    }
    if (listing.data?.map?.name) {
      console.log(`   Name: ${listing.data.map.name}`)
    }
    console.log(`   View: ${API_BASE}/content/${listing.outpoint}`)
    console.log('')
  }
}

const args = process.argv.slice(2)
if (args.length === 0) {
  console.error('Usage: bun run listings.ts <owner-address>')
  console.error('')
  console.error('Examples:')
  console.error("  bun run listings.ts '1Address...'")
  process.exit(1)
}

getListings(args[0]).catch((e) => {
  console.error('Error:', e.message)
  process.exit(1)
})
