/**
 * Content script - Bridges page and background
 *
 * Injects the provider script and relays messages
 */

import { createContentBridge } from '@1sat/extension'

// Inject the provider script into the page
const script = document.createElement('script')
script.src = chrome.runtime.getURL('inject.js')
script.type = 'module'
;(document.head || document.documentElement).appendChild(script)
script.onload = () => script.remove()

// Create the message bridge
createContentBridge({ debug: false })
