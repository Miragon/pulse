import { readFileSync, realpathSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import * as esbuild from "esbuild"
import { beforeAll, describe, expect, test } from "vitest"
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
} from "../../../scripts/third-party-licenses.mjs"

interface PluginBuild {
  readonly PLUGIN_FILES: Readonly<Record<string, string>>
  readonly pluginBuilds: (out: string) => Readonly<Record<string, esbuild.BuildOptions>>
}

const APP = realpathSync(fileURLToPath(new URL("..", import.meta.url)))
const REPO = join(APP, "..", "..")
const LICENCES_FILE = join(APP, "THIRD_PARTY_LICENSES.txt")
const PLUGIN_BUILD = new URL("../scripts/build.mjs", import.meta.url).href
const PRIMITIVES = "packages/core/ui/dist/primitives/"
const ESBUILD_DIR = dirname(
  createRequire(join(APP, "package.json")).resolve("esbuild/package.json"),
)
const PARTS = ["worker", "panel", "bridge", "webview"] as const
const PART_NAMES: Readonly<Record<string, string>> = {
  worker: "the worker",
  panel: "the panel",
  bridge: "the frames' bridge",
  webview: "the webview",
}

function phrase(names: readonly string[]): string {
  return names.length < 2
    ? names.join("")
    : `${names.slice(0, -1).join(", ")} and ${names.at(-1) ?? ""}`
}

function everySetOfParts(): Record<string, string> {
  const sets = PARTS.reduce<string[][]>(
    (subsets, part) => [...subsets, ...subsets.map((subset) => [...subset, part])],
    [[]],
  ).filter((subset) => subset.length > 0)
  return Object.fromEntries(
    sets.map((set) => [set.join(" "), phrase(set.map((part) => PART_NAMES[part] ?? part))]),
  )
}

const LAYOUT: Layout = {
  repo: REPO,
  home: APP,
  bundles: PARTS,
  virtual: {
    [ESBUILD_RUNTIME]: {
      dir: ESBUILD_DIR,
      holds: "the runtime helpers esbuild writes into the bundles",
    },
  },
  embedded: {
    [PRIMITIVES]: () => ({
      name: "shadcn/ui",
      version: "new-york-v4",
      licence: "MIT",
      holds:
        "the components the primitives of Pulse's design kit @miragon/pulse-ui build on, " +
        "changed by Miragon GmbH (packages/core/ui/src/primitives)",
      source: "https://github.com/shadcn-ui/ui (apps/v4/registry/new-york-v4/ui)",
      texts: licenceTexts(join(REPO, "packages/core/ui/src/primitives"), "shadcn/ui"),
    }),
  },
}

const TEXT: LicenceFileText = {
  regenerate: "pnpm --fail-if-no-match --filter @miragon/pulse-orca third-party-licenses",
  intro: [
    "Third-party licences of Pulse for Orca (miragon.pulse-cockpit)",
    "",
    "The plugin folder of Pulse for Orca holds the plugin's own code, under the MIT licence in",
    "LICENSE, and the works listed here, each under its own licence, which esbuild bundles into",
    "the worker (worker.mjs), the panel (panel/engines.js), the frames' bridge (editor/bridge.js)",
    "and the webview (editor/webview.js, editor/webview.css and the fonts in editor/fonts).",
    "apps/orca/test/third-party-licenses.test.ts of https://github.com/Miragon/pulse writes this",
    "file from the metafiles of the four builds and the stylesheets the webview's Tailwind entry",
    "inlines into editor/webview.css.",
  ],
  notes: [],
  artifacts: everySetOfParts(),
  titles: {
    works: "Works of others in the bundles:",
    own: "Pulse's own packages in the bundles, under the MIT licence in LICENSE:",
  },
}

async function modulesOf(options: esbuild.BuildOptions): Promise<string[]> {
  const result = await esbuild.build({
    ...options,
    absWorkingDir: APP,
    write: false,
    metafile: true,
    minify: false,
    sourcemap: false,
    logLevel: "silent",
  })
  return [
    ...esbuildModules({ metafile: result.metafile, outputFiles: result.outputFiles }, APP),
    ...inlinedStylesheets(options.plugins ?? []),
  ]
}

async function bundledModules(): Promise<Record<string, string[]>> {
  const { pluginBuilds } = (await import(PLUGIN_BUILD)) as PluginBuild
  const builds = pluginBuilds(join(APP, "dist/"))
  const modules = await Promise.all(
    PARTS.map(async (part) => [part, await modulesOf(builds[part] ?? {})] as const),
  )
  return Object.fromEntries(modules)
}

describe("THIRD_PARTY_LICENSES.txt", { timeout: 120_000 }, () => {
  let inventory: Inventory

  beforeAll(async () => {
    inventory = inventoryOf(await bundledModules(), LAYOUT)
  }, 120_000)

  test("lists exactly the works of others the bundles hold, with their licence files", () => {
    if (process.env.THIRD_PARTY_LICENSES_UPDATE === "1") {
      expect(process.env.CI, "the file is written locally, never in CI").toBeUndefined()
      writeFileSync(LICENCES_FILE, renderLicences(inventory, TEXT))
    }
    expect(licenceFindings(readFileSync(LICENCES_FILE, "utf8"), inventory, TEXT)).toEqual([])
  })

  test("reads the fonts, the stylesheet, the icons and the UI runtime of the webview", () => {
    const names = inventory.thirdParty.map(({ name }) => name)
    expect(names).toEqual(
      expect.arrayContaining([
        "@fontsource-variable/geist",
        "@fontsource-variable/geist-mono",
        "bpmn-js",
        "lucide-react",
        "react",
        "react-dom",
        "shadcn/ui",
        "tailwindcss",
      ]),
    )
    expect(names).not.toContain("preact")
  })

  test("fails while it misses a work the bundles hold, or lists one they hold no more", () => {
    const [first] = inventory.thirdParty
    const without = { ...inventory, thirdParty: inventory.thirdParty.slice(1) }
    const regenerate = `run \`${TEXT.regenerate}\``
    expect(licenceFindings(renderLicences(without, TEXT), inventory, TEXT)[0]).toMatch(
      new RegExp(`^${first?.name ?? ""} .* but THIRD_PARTY_LICENSES.txt does not list it`),
    )
    expect(licenceFindings(renderLicences(inventory, TEXT), without, TEXT)).toEqual([
      `THIRD_PARTY_LICENSES.txt lists ${first?.name ?? ""}, which no bundle holds any more: ${regenerate}`,
    ])
  })

  test("ships beside LICENSE in the plugin folder, which the release checks", async () => {
    const { PLUGIN_FILES } = (await import(PLUGIN_BUILD)) as PluginBuild
    expect(PLUGIN_FILES).toMatchObject({
      LICENSE: "LICENSE",
      "THIRD_PARTY_LICENSES.txt": "THIRD_PARTY_LICENSES.txt",
    })
    expect(readFileSync(join(APP, "LICENSE"), "utf8")).toBe(
      readFileSync(join(REPO, "LICENSE"), "utf8"),
    )
    const publish = readFileSync(join(REPO, ".github/workflows/publish-orca-plugin.yml"), "utf8")
    expect(publish).toMatch(/for file in [^\n]* \.\/LICENSE \.\/THIRD_PARTY_LICENSES\.txt[ ;]/)
  })
})
