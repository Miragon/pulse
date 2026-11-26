/// <reference types="node" />
import { readFileSync, realpathSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { beforeAll, describe, expect, it } from "vitest"
import {
  ESBUILD_RUNTIME,
  esbuildModules,
  inlinedStylesheets,
  type Inventory,
  inventoryOf,
  type Layout,
  licenceFindings,
  type LicenceFileText,
  licenceTexts,
  renderLicences,
} from "../../../../scripts/third-party-licenses.mjs"
import {
  buildBrowserBundle,
  PACKAGE,
  RUNTIME,
  STYLESHEET,
  STYLESHEET_MODULE,
} from "../scripts/browser-bundle.mjs"

/**
 * THIRD_PARTY_LICENSES.txt of the npm package: what the browser bundle in dist/browser/ holds of
 * works that are not Pulse's own (React, the icons, Radix, Tailwind's base, …), read from the
 * metafiles of its builds and the stylesheets its Tailwind entry inlines. The package's own
 * modules (dist/, src/) import those works and bundle none, so the list names the bundle's files;
 * only the shadcn/ui components the primitives build on sit in them too, under the licence in
 * src/primitives/LICENSE, which the intro says.
 * `pnpm --fail-if-no-match --filter @miragon/pulse-ui third-party-licenses` writes it.
 */

const HOME = realpathSync(PACKAGE)
const REPO = join(HOME, "..", "..", "..")
const LICENCES_FILE = join(HOME, "THIRD_PARTY_LICENSES.txt")
const ESBUILD_DIR = dirname(
  createRequire(join(HOME, "package.json")).resolve("esbuild/package.json"),
)

/**
 * Pulse's own glue, which the list never names: pulse-ui.js's source, which the build writes (its
 * root entry and React's names), and the modules a later entry imports those names through.
 */
const isGlue = (id: string) =>
  id === join(HOME, RUNTIME) || /^\0(?:pulse-ui-shared|pulse-ui-kit):/.test(id)

const words = (names: readonly string[]) =>
  names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1) ?? ""}`

/**
 * The bundle's files, as the list names them: the scripts, then the stylesheet and the module that
 * holds its text.
 */
let bundles: string[] = []

function artifacts(): Record<string, string> {
  const sets = bundles
    .reduce<string[][]>((subsets, file) => [...subsets, ...subsets.map((s) => [...s, file])], [[]])
    .filter((set) => set.length > 0)
  return Object.fromEntries(
    sets.map((set) => [set.join(" "), words(set.map((f) => `dist/browser/${f}`))]),
  )
}

const layout = (): Layout => ({
  repo: REPO,
  home: HOME,
  bundles,
  virtual: {
    [ESBUILD_RUNTIME]: {
      dir: ESBUILD_DIR,
      holds: "the runtime helpers esbuild writes into the bundle",
    },
  },
  embedded: {
    "packages/core/ui/src/primitives/": () => ({
      name: "shadcn/ui",
      version: "new-york-v4",
      licence: "MIT",
      holds:
        "the components the primitives of Pulse's design kit @miragon/pulse-ui build on, " +
        "changed by Miragon GmbH (packages/core/ui/src/primitives)",
      source: "https://github.com/shadcn-ui/ui (apps/v4/registry/new-york-v4/ui)",
      texts: licenceTexts(join(HOME, "src/primitives"), "shadcn/ui"),
    }),
  },
  licenceFiles: {
    "react-remove-scroll-bar@2.3.8": {
      dir: "packages/core/ui/licences/react-remove-scroll-bar",
      from:
        "none in its npm package, whose package.json names MIT; the LICENSE of " +
        "https://github.com/theKashey/react-remove-scroll-bar (commit 7301c160, after 2.3.8)",
    },
  },
})

const text = (): LicenceFileText => ({
  regenerate: "pnpm --fail-if-no-match --filter @miragon/pulse-ui third-party-licenses",
  intro: [
    "Third-party licences of @miragon/pulse-ui",
    "",
    "The package holds its own code, under the MIT licence in LICENSE, and, in its browser bundle",
    "for a page without a build (dist/browser/), the works listed here, each under its own",
    "licence, which esbuild and Tailwind bundle into it. Its other modules import those works and",
    "hold none of them, but for shadcn/ui: the components its primitives build on, changed by",
    "Miragon GmbH, are in src/primitives and dist/primitives too, under src/primitives/LICENSE.",
    "packages/core/ui/test/third-party-licenses.test.ts of https://github.com/Miragon/pulse writes",
    "this file from the metafiles of the bundle's builds and the stylesheets its Tailwind entry",
    "inlines into dist/browser/pulse-ui.css, whose text dist/browser/pulse-ui-css.js holds too.",
  ],
  notes: [],
  artifacts: artifacts(),
  titles: {
    works: "Works of others in the browser bundle:",
    own: "Pulse's own packages in the browser bundle, under the MIT licence in LICENSE:",
  },
})

describe("THIRD_PARTY_LICENSES.txt", { timeout: 120_000 }, () => {
  let inventory: Inventory

  beforeAll(async () => {
    const bundle = await buildBrowserBundle({ minify: false })
    const scripts = Object.keys(bundle.results)
    bundles = [...scripts, STYLESHEET, STYLESHEET_MODULE]
    const modules = Object.fromEntries(
      scripts.map((file) => {
        const result = bundle.results[file]
        if (result === undefined) throw new Error(`the bundle built no ${file}`)
        const ids = esbuildModules(
          { metafile: result.metafile, outputFiles: result.outputFiles },
          HOME,
        )
        return [file, ids.filter((id) => !isGlue(id))]
      }),
    )
    modules[STYLESHEET] = inlinedStylesheets([bundle.stylesheet])
    // pulse-ui-css.js holds the stylesheet's text, so it holds exactly the works the stylesheet does.
    modules[STYLESHEET_MODULE] = modules[STYLESHEET]
    inventory = inventoryOf(modules, layout())
  }, 120_000)

  it("lists exactly the works of others the bundle holds, with their licence files", () => {
    if (process.env.THIRD_PARTY_LICENSES_UPDATE === "1") {
      expect(process.env.CI, "the file is written locally, never in CI").toBeUndefined()
      writeFileSync(LICENCES_FILE, renderLicences(inventory, text()))
    }
    expect(licenceFindings(readFileSync(LICENCES_FILE, "utf8"), inventory, text())).toEqual([])
  })

  it("reads React, the icons, the primitives, Tailwind's base and esbuild's helpers", () => {
    const names = inventory.thirdParty.map(({ name }) => name)
    expect(names).toEqual(
      expect.arrayContaining([
        "esbuild",
        "lucide-react",
        "react",
        "react-dom",
        "scheduler",
        "shadcn/ui",
        "tailwindcss",
        "tw-animate-css",
      ]),
    )
    expect(inventory.thirdParty.find(({ name }) => name === "react")?.bundles).toEqual([RUNTIME])
  })

  it("names pulse-ui-css.js beside pulse-ui.css for every work the stylesheet holds", () => {
    const inStylesheet = inventory.thirdParty.filter(({ bundles }) => bundles.includes(STYLESHEET))
    expect(inStylesheet.map(({ name }) => name)).toEqual(
      expect.arrayContaining(["tailwindcss", "tw-animate-css"]),
    )
    for (const work of inStylesheet) expect(work.bundles, work.name).toContain(STYLESHEET_MODULE)
    expect(
      inventory.thirdParty.filter(({ bundles }) => bundles.includes(STYLESHEET_MODULE)),
    ).toEqual(inStylesheet)
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
