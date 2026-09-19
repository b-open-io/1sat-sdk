/**
 * Originator the CLI's permissions manager treats as the wallet itself.
 *
 * `LocalWalletPermissionsManager` lets its admin originator bypass every
 * permission check, so this value must only ever be used by in-process code
 * (the CLI's own commands run against the raw wallet, which needs no
 * originator; anything the CLI routes through the manager on its own behalf
 * passes this constant). The wallet-api router rejects any HTTP request whose
 * origin normalizes to it, so an app cannot claim it. It is a hostname-shaped
 * string that is stable under the manager's originator normalization
 * (lowercase, no scheme, no port).
 */
export const CLI_ADMIN_ORIGINATOR = '1sat-cli.internal'
