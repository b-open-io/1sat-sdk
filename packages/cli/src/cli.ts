/**
 * CLI entry. Must set DOTENV_CONFIG_QUIET before any import that pulls in
 * @bsv/wallet-toolbox (Setup / MonitorDaemon call dotenv.config() at load).
 */

process.env.DOTENV_CONFIG_QUIET = 'true'

await import('./main.ts')
