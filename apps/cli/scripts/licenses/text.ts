/**
 * What the CLI's THIRD_PARTY_LICENSES.txt says around the works its bundles hold: the licence
 * list of the repository (scripts/third-party-licenses.mjs) renders it.
 */

import type { LicenceFileText } from "../../../../scripts/third-party-licenses.mjs"

const INTRO = [
  "Third-party licences of the Pulse CLI (@miragon/pulse-cli)",
  "",
  "The npm package @miragon/pulse-cli, the image ghcr.io/miragon/pulse-cli and the single",
  "executables of the Pulse CLI hold the CLI's own code, under the MIT licence in LICENSE, and the",
  "works listed here, each under its own licence. apps/cli/scripts/third-party-licenses.ts of",
  "https://github.com/Miragon/pulse writes this file from the module graphs of the CLI's two",
  "bundles: the npm package's and the standalone bundle of the image and the executables.",
]

const NODE = [
  "Node.js is not listed: the npm package runs on yours, the image on the one of its base image,",
  "with its licence in /nodejs/LICENSE, and each executable embeds the Node.js that built it, whose",
  "licence the .tar.xz archive of a macOS or Linux executable holds as NODE_LICENSE and the GitHub",
  "release attaches for every executable as pulse-cli-NODE_LICENSE.",
]

export const CLI_TEXT: LicenceFileText = {
  regenerate: "pnpm --fail-if-no-match --filter @miragon/pulse-cli third-party-licenses",
  intro: INTRO,
  notes: NODE,
  // the artifacts a set of bundles reaches, by the bundles' names joined with a space
  artifacts: {
    "npm standalone": "the npm package, the image and the executables",
    npm: "the npm package",
    standalone: "the image and the executables",
  },
  titles: {
    works: "Works of others in the bundles:",
    own: "Pulse's own packages in the bundles, under the MIT licence in LICENSE:",
    installed: "Dependencies npm installs beside the npm package, each with its own licence:",
  },
}
