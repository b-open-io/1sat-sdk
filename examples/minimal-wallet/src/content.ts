/**
 * Content script - Bridges page and background
 *
 * Injects the provider script and relays messages
 */

import { createContentBridge } from '@1sat/extension'
import browser from 'webextension-polyfill'

// Inject the provider script into the page
const script = document.createElement('script')
script.src = browser.runtime.getURL('inject.js')
script.type = 'module'
;(document.head || document.documentElement).appendChild(script)
script.onload = () => script.remove()

// Create the message bridge
createContentBridge({ debug: false })
