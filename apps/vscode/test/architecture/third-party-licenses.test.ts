import { readFileSync, realpathSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import * as esbuild from "esbuild"
import { beforeAll, describe, expect, test } from "vitest"
import {
  ESBUILD_RUNTIME,
  esbuildModules,
  type Inventory,
  inventoryOf,
  type Layout,
  licenceFindings,
  type LicenceFileText,
  renderLicences,
  type Work,
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

interface Glyphs {
  readonly $description: string
  readonly license: Readonly<Record<string, string>>
}

const APP = realpathSync(APP_ROOT)
const REPO = realpathSync(REPO_ROOT)
const LICENCES_FILE = join(APP, "THIRD_PARTY_LICENSES.txt")
const HOST_BUILD = new URL("../../scripts/build.mjs", import.meta.url).href
const WEBVIEW_BUILD = new URL(
  "../../node_modules/@miragon/pulse-runtime-view/scripts/webview-build-options.mjs",
  import.meta.url,
).href
const GLYPHS = "packages/core/runtime-view/src/webview/components/lucide-glyphs.json"
const ESBUILD_DIR = dirname(
  createRequire(join(APP, "package.json")).resolve("esbuild/package.json"),
)

function lucideWork(): Work {
  const glyphs = JSON.parse(readFileSync(join(REPO, GLYPHS), "utf8")) as Glyphs
  const version = /lucide-preact (\d+\.\d+\.\d+)/.exec(glyphs.$description)?.[1]
  if (version === undefined) throw new Error(`${GLYPHS} names no lucide-preact version`)
  return {
    name: "lucide-preact",
    version,
    licence: "ISC",
    source: "https://github.com/lucide-icons/lucide",
    holds:
      "the geometry of the Lucide icons the webview draws, without lucide-preact's runtime " +
      `(${GLYPHS}), some of them derived from Feather (MIT)`,
    texts: Object.entries(glyphs.license).map(([work, text]) => ({
      file: `license.${work} of lucide-glyphs.json`,
      text,
    })),
  }
}

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
  embedded: { [GLYPHS]: lucideWork },
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
    "https://github.com/Miragon/pulse writes this file from the metafiles of both builds.",
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
  return esbuildModules({ metafile: result.metafile, outputFiles: result.outputFiles }, APP)
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

  test("reads the fonts, the stylesheet, the icons and esbuild's helpers of the bundles", () => {
    expect(inventory.thirdParty.map(({ name }) => name)).toEqual(
      expect.arrayContaining([
        "@fontsource-variable/geist",
        "@fontsource-variable/geist-mono",
        "bpmn-js",
        "esbuild",
        "lucide-preact",
      ]),
    )
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
