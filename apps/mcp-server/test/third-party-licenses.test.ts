import { readFileSync, realpathSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join, relative } from "node:path"
import { fileURLToPath } from "node:url"
import { build, type Plugin, type Rolldown } from "vite"
import { beforeAll, describe, expect, it } from "vitest"
import {
  cssDependencies,
  type Inventory,
  inventoryOf,
  type Layout,
  licenceFindings,
  type LicenceFileText,
  licenceTexts,
  renderedModules,
  renderLicences,
} from "../../../scripts/third-party-licenses.mjs"
import viteConfig from "../vite.config.js"

/**
 * THIRD_PARTY_LICENSES.txt, which the server image ships in /usr/share/doc/pulse-server beside
 * LICENSE (docs/mcp/operations.md): what the view bundle holds of works of others, read from the
 * module graph Vite builds of it from vite.config.ts, nothing written, and the stylesheets it
 * inlines into mcp-app.css. The server inlines the bundle into every view it serves, so the
 * licences go into the image, never into the bundle (its gzip budget). The image's other code is
 * the server's own (/app/dist) and its dependencies (/app/node_modules), each with its licence
 * files. The licence list's planted cases are in scripts/third-party-licenses.test.mjs of the
 * repository. With THIRD_PARTY_LICENSES_UPDATE=1 (`pnpm --fail-if-no-match --filter
 * @miragon/pulse-mcp-server third-party-licenses`) the test writes the file instead.
 */

const APP = realpathSync(fileURLToPath(new URL("..", import.meta.url)))
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
  bundles: ["view"],
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
      dir: "apps/mcp-server/licences/react-remove-scroll-bar",
      from:
        "none in its npm package, whose package.json names MIT; the LICENSE of " +
        "https://github.com/theKashey/react-remove-scroll-bar (commit 7301c160, after 2.3.8)",
    },
  },
}

const TEXT: LicenceFileText = {
  regenerate: "pnpm --fail-if-no-match --filter @miragon/pulse-mcp-server third-party-licenses",
  intro: [
    "Third-party licences of the Pulse MCP server image (ghcr.io/miragon/pulse-server)",
    "",
    "The image ghcr.io/miragon/pulse-server holds the server's own code (/app/dist), under the MIT",
    "licence in LICENSE, its dependencies (/app/node_modules), each with its own licence files, and",
    "the view bundle (/app/dist/mcp-app.js and mcp-app.css), which the server inlines into every",
    "view it serves and which holds the works listed here, each under its own licence.",
    "apps/mcp-server/test/third-party-licenses.test.ts of https://github.com/Miragon/pulse writes",
    "this file from the module graph Vite builds of the view bundle.",
  ],
  notes: [
    "Node.js is not listed: the image runs the one of its base image, with its licence in",
    "/usr/local/LICENSE.",
  ],
  artifacts: { view: "the view bundle" },
  titles: {
    works: "Works of others in the view bundle:",
    own: "Pulse's own packages in the view bundle, under the MIT licence in LICENSE:",
  },
}

/**
 * The modules the view bundle holds code of, and the stylesheets it inlines, built as `vite
 * build` builds it: for production, which Vitest's NODE_ENV=test would turn into React's
 * development builds.
 */
async function viewModules(): Promise<string[]> {
  const css = cssDependencies()
  const nodeEnv = process.env.NODE_ENV
  process.env.NODE_ENV = "production"
  try {
    const output = await build({
      ...viteConfig,
      configFile: false,
      root: APP,
      mode: "production",
      logLevel: "silent",
      plugins: [...(viteConfig.plugins ?? []), css.plugin as Plugin],
      build: { ...viteConfig.build, write: false },
    })
    const outputs = (Array.isArray(output) ? output : [output]) as Rolldown.RolldownOutput[]
    const chunks = outputs.flatMap(({ output: each }) => each)
    return [...renderedModules(chunks), ...css.files(chunks)]
  } finally {
    if (nodeEnv === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = nodeEnv
  }
}

describe("THIRD_PARTY_LICENSES.txt", { timeout: 120_000 }, () => {
  let modules: string[]
  let inventory: Inventory

  beforeAll(async () => {
    modules = await viewModules()
    inventory = inventoryOf({ view: modules }, LAYOUT)
  }, 120_000)

  it("lists exactly the works of others the view bundle holds, with their licence files", () => {
    if (process.env.THIRD_PARTY_LICENSES_UPDATE === "1") {
      expect(process.env.CI, "the file is written locally, never in CI").toBeUndefined()
      writeFileSync(LICENCES_FILE, renderLicences(inventory, TEXT))
    }
    expect(licenceFindings(readFileSync(LICENCES_FILE, "utf8"), inventory, TEXT)).toEqual([])
  })

  it("reads the stylesheets the bundle inlines and the code of Pulse's packages", () => {
    const names = inventory.thirdParty.map(({ name }) => name)
    // Tailwind's preflight and tw-animate-css reach mcp-app.css through @import only
    expect(names).toEqual(expect.arrayContaining(["tailwindcss", "tw-animate-css", "shadcn/ui"]))
    expect(inventory.own).toEqual([
      "@miragon/pulse-engine-connector",
      "@miragon/pulse-ui",
      "@miragon/pulse-widget-shell",
    ])
    // what an @import pulls in, never a stylesheet Tailwind only scans for class names
    const stylesheets = modules.filter((id) => id.endsWith(".css")).map((id) => relative(REPO, id))
    expect(stylesheets.filter((id) => !id.startsWith("node_modules/"))).toEqual([
      "apps/mcp-server/src/ui/globals.css",
      "packages/core/ui/src/theme.css",
      "packages/core/ui/src/tokens/cd-tokens.generated.css",
    ])
  })

  it("reads the bundle `vite build` makes, with React's production builds", () => {
    const react = modules.filter((id) => /\/react(?:-dom)?\/cjs\//.test(id))
    expect(react.length).toBeGreaterThan(0)
    expect(react.filter((id) => !id.endsWith(".production.js"))).toEqual([])
  })

  it("fails while it misses a work the bundle holds, or lists one the bundle holds no more", () => {
    const [first] = inventory.thirdParty
    const without = { ...inventory, thirdParty: inventory.thirdParty.slice(1) }
    const regenerate = `run \`${TEXT.regenerate}\``
    expect(licenceFindings(renderLicences(without, TEXT), inventory, TEXT)).toEqual([
      `${first?.name ?? ""} ${first?.version ?? ""} is in the view bundle, but THIRD_PARTY_LICENSES.txt does not list it: ${regenerate}`,
    ])
    expect(licenceFindings(renderLicences(inventory, TEXT), without, TEXT)).toEqual([
      `THIRD_PARTY_LICENSES.txt lists ${first?.name ?? ""}, which no bundle holds any more: ${regenerate}`,
    ])
  })

  it("ships beside LICENSE in the image, which the Docker build checks", () => {
    const dockerfile = readFileSync(join(REPO, "Dockerfile"), "utf8")
    const runtime = dockerfile.slice(dockerfile.indexOf("\nFROM base AS runtime\n"))
    expect(runtime).toContain(
      "\nCOPY LICENSE apps/mcp-server/THIRD_PARTY_LICENSES.txt /usr/share/doc/pulse-server/\n",
    )
    const check = readFileSync(join(REPO, ".github/workflows/docker-build.yml"), "utf8")
    for (const file of ["LICENSE", "THIRD_PARTY_LICENSES.txt"]) {
      expect(check).toContain(`test -s /usr/share/doc/pulse-server/${file}`)
    }
    expect(check).toContain("test -s /usr/local/LICENSE")
    expect(check).toMatch(/paths:\n(?: {6}- .*\n)*? {6}- LICENSE\n/)
  })
})
