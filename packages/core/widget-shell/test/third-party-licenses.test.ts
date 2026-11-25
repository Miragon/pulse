import { readFileSync, realpathSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { beforeAll, describe, expect, it } from "vitest"
import {
  ESBUILD_RUNTIME,
  esbuildModules,
  type Inventory,
  inventoryOf,
  type Layout,
  licenceFindings,
  type LicenceFileText,
  renderLicences,
} from "../../../../scripts/third-party-licenses.mjs"
import {
  BUNDLE,
  buildBrowserBundle,
  PACKAGE,
  SHARED_NAMESPACE,
} from "../scripts/browser-bundle.mjs"

/**
 * THIRD_PARTY_LICENSES.txt of the npm package: what the browser bundle in dist/browser/ holds of
 * works that are not Pulse's own (TanStack Query, lucide-react's provider), read from the metafile
 * of its build. The package's own modules (dist/, src/) import those works and bundle none, and
 * the bundle imports React, ReactDOM and the kit from pulse-ui's browser bundle, whose list names
 * them, so the list names the bundle's one file.
 * `pnpm --fail-if-no-match --filter @miragon/pulse-widget-shell third-party-licenses` writes it.
 */

const HOME = realpathSync(PACKAGE)
const REPO = join(HOME, "..", "..", "..")
const LICENCES_FILE = join(HOME, "THIRD_PARTY_LICENSES.txt")
const ESBUILD_DIR = dirname(
  createRequire(join(HOME, "package.json")).resolve("esbuild/package.json"),
)

/**
 * Pulse's own glue, which the list never names: the bundle's entry, which the build writes (its
 * `export *` lines), and the modules that stand for pulse-ui.js.
 */
const isGlue = (id: string) => id === join(HOME, BUNDLE) || id.startsWith(`\0${SHARED_NAMESPACE}:`)

const layout: Layout = {
  repo: REPO,
  home: HOME,
  bundles: [BUNDLE],
  virtual: {
    [ESBUILD_RUNTIME]: {
      dir: ESBUILD_DIR,
      holds: "the runtime helpers esbuild writes into the bundle",
    },
  },
  embedded: {},
}

const text: LicenceFileText = {
  regenerate: "pnpm --fail-if-no-match --filter @miragon/pulse-widget-shell third-party-licenses",
  intro: [
    "Third-party licences of @miragon/pulse-widget-shell",
    "",
    "The package holds its own code, under the MIT licence in LICENSE, and, in its browser bundle",
    "for a page without a build (dist/browser/claude-artifact.js), the works listed here, each",
    "under its own licence, which esbuild bundles into it. Its other modules import those works",
    "and hold none of them. The bundle holds neither React nor @miragon/pulse-ui: it imports both",
    "from pulse-ui's browser bundle, whose THIRD_PARTY_LICENSES.txt lists what that one holds.",
    "packages/core/widget-shell/test/third-party-licenses.test.ts of https://github.com/Miragon/pulse",
    "writes this file from the metafile of the bundle's build.",
  ],
  notes: [],
  artifacts: { [BUNDLE]: `dist/browser/${BUNDLE}` },
  titles: {
    works: "Works of others in the browser bundle:",
    own: "Pulse's own packages in the browser bundle, under the MIT licence in LICENSE:",
  },
}

describe("THIRD_PARTY_LICENSES.txt", { timeout: 120_000 }, () => {
  let inventory: Inventory

  beforeAll(async () => {
    const { result } = await buildBrowserBundle({ minify: false })
    const ids = esbuildModules({ metafile: result.metafile, outputFiles: result.outputFiles }, HOME)
    inventory = inventoryOf({ [BUNDLE]: ids.filter((id) => !isGlue(id)) }, layout)
  }, 120_000)

  it("lists exactly the works of others the bundle holds, with their licence files", () => {
    if (process.env.THIRD_PARTY_LICENSES_UPDATE === "1") {
      expect(process.env.CI, "the file is written locally, never in CI").toBeUndefined()
      writeFileSync(LICENCES_FILE, renderLicences(inventory, text))
    }
    expect(licenceFindings(readFileSync(LICENCES_FILE, "utf8"), inventory, text)).toEqual([])
  })

  it("reads TanStack Query and lucide-react, and neither React nor the kit", () => {
    const names = inventory.thirdParty.map(({ name }) => name)
    expect(names).toEqual(
      expect.arrayContaining(["@tanstack/query-core", "@tanstack/react-query", "lucide-react"]),
    )
    for (const held of ["react", "react-dom", "scheduler"]) expect(names).not.toContain(held)
    expect(inventory.own).not.toContain("@miragon/pulse-ui")
  })

  it("runs again in turbo when a file it reads outside the package changes", () => {
    const turbo = JSON.parse(readFileSync(join(HOME, "turbo.json"), "utf8")) as {
      tasks: { test: { inputs: string[] } }
    }
    expect(turbo.tasks.test.inputs).toEqual(
      expect.arrayContaining([
        "$TURBO_ROOT$/scripts/third-party-licenses.mjs",
        "$TURBO_ROOT$/scripts/third-party-licenses.d.mts",
        "$TURBO_ROOT$/LICENSE",
      ]),
    )
  })

  it("ships in the package beside LICENSE", () => {
    const manifest = JSON.parse(readFileSync(join(HOME, "package.json"), "utf8")) as {
      files: string[]
    }
    expect(manifest.files).toEqual(expect.arrayContaining(["dist", "THIRD_PARTY_LICENSES.txt"]))
    expect(readFileSync(join(HOME, "LICENSE"), "utf8")).toBe(
      readFileSync(join(REPO, "LICENSE"), "utf8"),
    )
  })
})
