/**
 * Inject script - Creates window.onesat provider
 *
 * This is the simplest possible inject script - just call injectOneSatProvider()
 */

import { injectOneSatProvider } from '@1sat/extension'

injectOneSatProvider({ walletName: 'Minimal Wallet' })
