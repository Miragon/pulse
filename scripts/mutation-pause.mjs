/**
 * Mutation testing is PAUSED while the MCP server is rebuilt (owner decision, 2026-10-31). The
 * rebuild deletes and moves whole modules, so the `mutate` allowlists and break floors would only
 * demand a Ratchet-Exception on every pull request. While it is paused:
 * - lint:ratchets skips the Stryker policies (check-ratchets.mjs),
 * - lint:package-scripts neither requires nor checks a stryker.config.json
 *   (check-package-scripts.mjs), so a new package needs none,
 * - the nightly run has no schedule (.github/workflows/mutation-nightly.yml; dispatch only).
 * Resuming: set this to false, restore the cron and give every source package a valid
 * stryker.config.json again (the gates then name each one that is missing or stale).
 */
export const MUTATION_PAUSED = true
