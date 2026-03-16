#!/usr/bin/env bun

import { inscribe, createContext } from '@1sat/actions'
import { createRemoteWallet } from '@1sat/wallet-remote'
import { readFile } from 'fs/promises'
import { basename, extname } from 'path'

const REMOTE_STORAGE_URL = 'https://1sat.shruggr.cloud/1sat/wallet'

function getContentType(filePath: string): string {
  const ext = extname(filePath).toLowerCase()
  const types: Record<string, string> = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.pdf': 'application/pdf',
    '.json': 'application/json',
    '.html': 'text/html',
    '.txt': 'text/plain',
    '.js': 'text/javascript',
    '.css': 'text/css',
  }
  return types[ext] || 'application/octet-stream'
}

async function main() {
  const args = process.argv.slice(2).filter(a => a !== '--sigma')
  const sigma = process.argv.includes('--sigma')

  if (args.length < 2) {
    console.log('Usage: bun run mint.ts <wif> <file-path> [metadata-json] [--sigma]')
    console.log('')
    console.log('Examples:')
    console.log('  bun run mint.ts L1abc... image.png')
    console.log('  bun run mint.ts L1abc... nft.jpg \'{"name":"My NFT"}\' --sigma')
    process.exit(1)
  }

  const [wifStr, filePath, metadataJson] = args

  const { wallet, destroy } = await createRemoteWallet({
    privateKey: wifStr,
    chain: 'main',
    remoteStorageUrl: REMOTE_STORAGE_URL,
  })

  try {
    const fileData = await readFile(filePath)
    const contentType = getContentType(filePath)
    const base64Content = fileData.toString('base64')

    console.log(`File: ${basename(filePath)} (${fileData.length} bytes, ${contentType})`)

    let map: Record<string, string> | undefined
    if (metadataJson) {
      try {
        map = JSON.parse(metadataJson)
      } catch (e) {
        console.error('Invalid metadata JSON:', (e as Error).message)
        process.exit(1)
      }
    }

    if (sigma) {
      console.log('Signing with BAP identity (Sigma protocol)...')
    }

    const ctx = createContext(wallet, { chain: 'main' })
    const result = await inscribe.execute(ctx, {
      base64Content,
      contentType,
      map,
      signWithBAP: sigma || undefined,
    })

    if (result.txid) {
      console.log(`Inscribed: ${result.txid}_0`)
      console.log(`https://whatsonchain.com/tx/${result.txid}`)
    } else {
      console.error('Error:', result.error)
      process.exit(1)
    }
  } finally {
    await destroy()
  }
}

main()
