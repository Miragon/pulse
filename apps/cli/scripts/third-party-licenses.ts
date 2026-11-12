/**
 * Writes `THIRD_PARTY_LICENSES.txt`, which the npm package, the image and the archives of the
 * single executables ship beside LICENSE and a release attaches as
 * pulse-cli-THIRD_PARTY_LICENSES.txt (scripts/release-licenses.sh): the works of others the CLI's
 * bundles hold, each with its licence and notice files, from the module graphs tsdown builds of
 * both bundles (scripts/licenses/), listed by the repository's licence list
 * (scripts/third-party-licenses.mjs). scripts/third-party-licenses.test.ts fails while the file is
 * out of date.
 * Usage: pnpm --fail-if-no-match --filter @miragon/pulse-cli third-party-licenses
 */

import { writeFile } from "node:fs/promises"
import { inventoryOf, renderLicences } from "../../../scripts/third-party-licenses.mjs"
import { bundledModules, CLI_LAYOUT, LICENCES_FILE } from "./licenses/bundles.js"
import { CLI_TEXT } from "./licenses/text.js"

const inventory = inventoryOf(await bundledModules(), CLI_LAYOUT)
await writeFile(LICENCES_FILE, renderLicences(inventory, CLI_TEXT))
console.log(`Wrote ${LICENCES_FILE}`)
