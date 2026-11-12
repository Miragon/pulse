/**
 * Writes `THIRD_PARTY_LICENSES.txt`, which the npm package, the image and the archives of the
 * single executables ship beside LICENSE: the works of others the CLI's bundles hold, each with
 * its licence and notice files, from the module graphs tsdown builds of both bundles
 * (scripts/licenses/). scripts/third-party-licenses.test.ts fails while the file is out of date.
 * Usage: pnpm --fail-if-no-match --filter @miragon/pulse-cli third-party-licenses
 */

import { writeFile } from "node:fs/promises"
import { bundledModules, CLI_LAYOUT, LICENCES_FILE } from "./licenses/bundles.js"
import { inventoryOf } from "./licenses/inventory.js"
import { renderLicences } from "./licenses/render.js"

await writeFile(LICENCES_FILE, renderLicences(inventoryOf(await bundledModules(), CLI_LAYOUT)))
console.log(`Wrote ${LICENCES_FILE}`)
