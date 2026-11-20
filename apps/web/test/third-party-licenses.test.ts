import { readFileSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join, relative } from "node:path"
import { beforeAll, describe, expect, it } from "vitest"
import {
  type Inventory,
  inventoryOf,
  type Layout,
  licenceFindings,
  type LicenceFileText,
  licenceTexts,
  renderLicences,
} from "../../../scripts/third-party-licenses.mjs"
import { APP, buildWeb } from "./web-build.js"

/**
 * THIRD_PARTY_LICENSES.txt, which the server image ships in /usr/share/doc/pulse-server/web (the
 * Dockerfile; apps/mcp-server/test/third-party-licenses.test.ts holds the copy): what the page
 * holds of works of others, read from the module graph Vite builds of it from vite.config.ts,
 * nothing written, and the stylesheets it inlines into its own. The browser gets no copy, as with
 * the view bundle. With THIRD_PARTY_LICENSES_UPDATE=1 (`pnpm --fail-if-no-match --filter
 * @miragon/pulse-web third-party-licenses`) the test writes the file instead.
 */

const REPO = dirname(dirname(APP))
const LICENCES_FILE = join(APP, "THIRD_PARTY_LICENSES.txt")

/** The package.json of the package `name` as the module at `from` resolves it. */
const manifestOf = (name: string, from: string): string =>
  createRequire(from).resolve(`${name}/package.json`)

/** rolldown as Vite runs it: the bundler that writes its runtime module into the bundle. */
const ROLLDOWN_DIR = dirname(manifestOf("rolldown", manifestOf("vite", import.meta.url)))

/** The primitives of pulse-ui, built on shadcn/ui's components, as the bundle takes them. */
const PRIMITIVES = "packages/core/ui/dist/primitives/"

const LAYOUT: Layout = {
  repo: REPO,
  home: APP,
  bundles: ["page"],
  virtual: {
    "\0rolldown/runtime.js": {
      dir: ROLLDOWN_DIR,
      holds: "the runtime helpers rolldown, Vite's bundler, writes into the bundle",
    },
  },
  embedded: {
    [PRIMITIVES]: () => ({
      name: "shadcn/ui",
      version: "new-york-v4",
      licence: "MIT",
      holds:
        "the components the primitives of Pulse's design kit @miragon/pulse-ui build on (Alert, " +
        "Badge, Button, Card, Dialog, Input, Skeleton, Switch, Table, Tabs), changed by Miragon " +
        "GmbH (packages/core/ui/src/primitives)",
      source: "https://github.com/shadcn-ui/ui (apps/v4/registry/new-york-v4/ui)",
      texts: licenceTexts(join(REPO, "packages/core/ui/src/primitives"), "shadcn/ui"),
    }),
  },
  licenceFiles: {
    "react-remove-scroll-bar@2.3.8": {
      dir: "apps/web/licences/react-remove-scroll-bar",
      from:
        "none in its npm package, whose package.json names MIT; the LICENSE of " +
        "https://github.com/theKashey/react-remove-scroll-bar (commit 7301c160, after 2.3.8)",
    },
  },
}

const TEXT: LicenceFileText = {
  regenerate: "pnpm --fail-if-no-match --filter @miragon/pulse-web third-party-licenses",
  intro: [
    "Third-party licences of Pulse's web app",
    "",
    "The web app is the page a Pulse server serves under /app, its script and its stylesheet under",
    "/app/assets: Pulse's own code, under the MIT licence in LICENSE, which holds the works listed",
    "here, each under its own licence. The server image ghcr.io/miragon/pulse-server holds the page",
    "in /app/web and this file in /usr/share/doc/pulse-server/web, below the image's LICENSE.",
    "apps/web/test/third-party-licenses.test.ts of https://github.com/Miragon/pulse writes this file",
    "from the module graph Vite builds of the page.",
  ],
  notes: [],
  artifacts: { page: "the page" },
  titles: {
    works: "Works of others in the page:",
    own: "Pulse's own packages in the page, under the MIT licence in LICENSE:",
  },
}

describe("THIRD_PARTY_LICENSES.txt", { timeout: 120_000 }, () => {
  let modules: readonly string[]
  let inventory: Inventory

  beforeAll(async () => {
    const build = await buildWeb()
    build.remove()
    modules = build.modules
    inventory = inventoryOf({ page: modules }, LAYOUT)
  }, 120_000)

  it("lists exactly the works of others the page holds, with their licence files", () => {
    if (process.env.THIRD_PARTY_LICENSES_UPDATE === "1") {
      expect(process.env.CI, "the file is written locally, never in CI").toBeUndefined()
      writeFileSync(LICENCES_FILE, renderLicences(inventory, TEXT))
    }
    expect(licenceFindings(readFileSync(LICENCES_FILE, "utf8"), inventory, TEXT)).toEqual([])
  })

  it("reads the stylesheets the page inlines and the code of Pulse's packages", () => {
    const names = inventory.thirdParty.map(({ name }) => name)
    // Tailwind's preflight and tw-animate-css reach the stylesheet through @import only
    expect(names).toEqual(expect.arrayContaining(["tailwindcss", "tw-animate-css", "shadcn/ui"]))
    expect(inventory.own).toEqual([
      "@miragon/pulse-blocks",
      "@miragon/pulse-engine-connector",
      "@miragon/pulse-screens",
      "@miragon/pulse-ui",
      "@miragon/pulse-widget-shell",
    ])
    const stylesheets = modules.filter((id) => id.endsWith(".css")).map((id) => relative(REPO, id))
    expect(stylesheets.filter((id) => !id.startsWith("node_modules/"))).toEqual([
      "apps/web/src/styles.css",
      "packages/core/ui/src/theme.css",
      "packages/core/ui/src/tokens/cd-tokens.generated.css",
    ])
  })

  it("reads the page `vite build` makes, with React's production builds", () => {
    const react = modules.filter((id) => /\/react(?:-dom)?\/cjs\//.test(id))
    expect(react.length).toBeGreaterThan(0)
    expect(react.filter((id) => !id.endsWith(".production.js"))).toEqual([])
  })

  it("fails while it misses a work the page holds, or lists one the page holds no more", () => {
    const [first] = inventory.thirdParty
    const without = { ...inventory, thirdParty: inventory.thirdParty.slice(1) }
    const regenerate = `run \`${TEXT.regenerate}\``
    expect(licenceFindings(renderLicences(without, TEXT), inventory, TEXT)).toEqual([
      `${first?.name ?? ""} ${first?.version ?? ""} is in the page, but THIRD_PARTY_LICENSES.txt does not list it: ${regenerate}`,
    ])
    expect(licenceFindings(renderLicences(inventory, TEXT), without, TEXT)).toEqual([
      `THIRD_PARTY_LICENSES.txt lists ${first?.name ?? ""}, which no bundle holds any more: ${regenerate}`,
    ])
  })
})
