import { readFileSync, realpathSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
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
} from "../../../../scripts/third-party-licenses.mjs"
import { APP_ROOT, REPO_ROOT } from "./support/files.js"

interface HostBuild {
  readonly hostBuildOptions: (options: { readonly production: boolean }) => esbuild.BuildOptions
}

interface WebviewBuild {
  readonly webviewBuildOptions: (options: {
    readonly production: boolean
    readonly outdir: string
  }) => esbuild.BuildOptions
}

const APP = realpathSync(APP_ROOT)
const REPO = realpathSync(REPO_ROOT)
const LICENCES_FILE = join(APP, "THIRD_PARTY_LICENSES.txt")
const HOST_BUILD = new URL("../../scripts/build.mjs", import.meta.url).href
const WEBVIEW_BUILD = new URL(
  "../../node_modules/@miragon/pulse-runtime-view/scripts/webview-build-options.mjs",
  import.meta.url,
).href
const PRIMITIVES = "packages/core/ui/dist/primitives/"
const ESBUILD_DIR = dirname(
  createRequire(join(APP, "package.json")).resolve("esbuild/package.json"),
)

const LAYOUT: Layout = {
  repo: REPO,
  home: APP,
  bundles: ["host", "webview"],
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
  regenerate: "pnpm --fail-if-no-match --filter pulse-cockpit third-party-licenses",
  intro: [
    "Third-party licences of Pulse for VS Code (miragon-gmbh.pulse-cockpit)",
    "",
    "The .vsix of Pulse for VS Code holds the extension's own code, under the MIT licence in",
    "LICENSE, and the works listed here, each under its own licence, which esbuild bundles into",
    "the extension host (dist/extension.cjs) and the webview (dist/webview.js, dist/webview.css",
    "and the fonts in dist/fonts). apps/vscode/test/architecture/third-party-licenses.test.ts of",
    "https://github.com/Miragon/pulse writes this file from the metafiles of both builds and the",
    "stylesheets the webview's Tailwind entry inlines into dist/webview.css.",
  ],
  notes: [],
  artifacts: {
    "host webview": "the extension host and the webview",
    host: "the extension host",
    webview: "the webview",
  },
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
  const { hostBuildOptions } = (await import(HOST_BUILD)) as HostBuild
  const { webviewBuildOptions } = (await import(WEBVIEW_BUILD)) as WebviewBuild
  return {
    host: await modulesOf(hostBuildOptions({ production: true })),
    webview: await modulesOf(webviewBuildOptions({ production: true, outdir: join(APP, "dist") })),
  }
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

  test("reads the fonts, the stylesheet, the icons, the UI runtime and esbuild's helpers of the bundles", () => {
    const names = inventory.thirdParty.map(({ name }) => name)
    expect(names).toEqual(
      expect.arrayContaining([
        "@fontsource-variable/geist",
        "@fontsource-variable/geist-mono",
        "bpmn-js",
        "esbuild",
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

  test("ships beside LICENSE in the .vsix, which the package job and the release check", () => {
    expect(readFileSync(join(APP, ".vscodeignore"), "utf8").split("\n")).toEqual(
      expect.arrayContaining(["!LICENSE", "!THIRD_PARTY_LICENSES.txt"]),
    )
    const checked = (workflow: string): string[] => {
      const text = readFileSync(join(REPO, ".github/workflows", workflow), "utf8")
      const list = /for file in (extension\/package\.json [^;\n]*); do/.exec(text)?.[1]
      return list?.split(" ") ?? []
    }
    expect(checked("ci.yml")).toContain("extension/THIRD_PARTY_LICENSES.txt")
    expect(checked("publish-vscode-extension.yml")).toEqual(checked("ci.yml"))
  })
})
