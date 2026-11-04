/**
 * The one switch that pauses mutation testing. True pauses it:
 * - lint:ratchets skips the Stryker policies (check-ratchets.mjs),
 * - lint:package-scripts checks neither MUTATED_PACKAGES nor any stryker.config.json
 *   (check-package-scripts.mjs),
 * - and the nightly run loses its schedule by hand (.github/workflows/mutation-nightly.yml;
 *   dispatch only), since a workflow cannot read this file.
 * False runs every gate and the nightly schedule.
 *
 * Mutation testing was paused while the MCP server was rebuilt (owner decision, 2026-10-31) and
 * resumed on 2026-11-04 for engine-core alone (owner decision, 2026-11-04: MUTATED_PACKAGES in
 * check-package-scripts.mjs). A later pause flips this to true and removes the cron; resuming
 * flips it back and restores the cron.
 */
export const MUTATION_PAUSED = false
